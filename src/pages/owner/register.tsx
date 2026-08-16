/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Component } from 'react';
import {
  Building2,
  Building as BuildingIcon,
  CreditCard,
  Zap,
  Droplet,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  ArrowRight,
  ArrowLeft,
  Plus,
  Trash2,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Edit3,
  MessageSquare,
  Facebook,
  Globe,
  Share2,
  PenTool,
  Save,
  HelpCircle,
  ExternalLink,
  Heart,
  FileSignature,
  FileText,
} from 'lucide-react';
import { onboardingClient, CompleteOnboardingPayload } from '../../data/onboardingClient';

interface RegisterProps {
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
  onNavigate?: (page: string) => void;
}

const PROVINCE_OPTIONS = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร',
  'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท',
  'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง',
  'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
  'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส',
  'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์',
  'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา',
  'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์',
  'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน',
  'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง',
  'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย',
  'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ',
  'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี',
  'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย',
  'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์',
  'อุทัยธานี', 'อุบลราชธานี'
];

const DORM_TYPE_OPTIONS = [
  'อพาร์ตเมนต์', 'หอพักนักศึกษา/นักเรียน', 'คอนโดมิเนียม', 'แมนชั่น', 'บ้านเช่า', 'Co-Living Space', 'อื่นๆ'
];

const GENDER_TYPE_OPTIONS = [
  { id: 'รวม', label: 'หอพักรวม (ชาย/หญิง)', desc: 'เปิดรับทั้งผู้เช่าชายและหญิง' },
  { id: 'ชาย', label: 'หอพักชายล้วน', desc: 'รับเฉพาะผู้เช่าเพศชายเท่านั้น' },
  { id: 'หญิง', label: 'หอพักหญิงล้วน', desc: 'รับเฉพาะผู้เช่าเพศหญิงเท่านั้น' }
];

const BANK_OPTIONS = [
  'ธนาคารกสิกรไทย (KBANK)',
  'ธนาคารไทยพาณิชย์ (SCB)',
  'ธนาคารกรุงเทพ (BBL)',
  'ธนาคารกรุงไทย (KTB)',
  'ธนาคารกรุงศรีอยุธยา (BAY)',
  'ธนาคารทหารไทยธนชาต (TTB)',
  'ธนาคารออมสิน (GSB)',
  'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร (ธ.ก.ส.)',
  'ธนาคาร ซีไอเอ็มบี ไทย (CIMBT)',
  'ธนาคารยูโอบี (UOB)',
  'ธนาคารแลนด์ แอนด์ เฮ้าส์ (LH Bank)',
  'ธนาคารเกียรตินาคินภัทร (KKP)'
];

const REFERRAL_OPTIONS = [
  { id: 'facebook', label: 'Facebook / สื่อสังคมออนไลน์', icon: Facebook },
  { id: 'google', label: 'Google Search / เว็บไซต์', icon: Globe },
  { id: 'friend', label: 'เพื่อน / คนรู้จักแนะนำ', icon: Share2 },
  { id: 'other', label: 'ช่องทางอื่นๆ', icon: MessageSquare }
];

const RULE_PRESETS = [
  'ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง (ฝ่าฝืนปรับ 2,000 บาท)',
  'ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.',
  'ชำระค่าเช่าและค่าน้ำไฟตรงตามกำหนดเวลา ภายในวันที่ 5 ของทุกเดือน',
  'ห้ามนำบุคคลภายนอกมาพักค้างคืนโดยไม่แจ้งเจ้าหน้าที่',
  'ห้ามเสพหรือนำสิ่งเสพติด/ของผิดกฎหมายเข้ามาในบริเวณหอพัก',
  'รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด',
];

// Formatting helpers
const formatPhone = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const formatBankAccount = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 15);
  if (digits.length <= 3) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 9)}-${digits.slice(9)}`;
};

function parseNum(val: any, fallback: number): number {
  if (val === undefined || val === null || val === '') return fallback;
  const num = Number(val);
  return Number.isNaN(num) ? fallback : num;
}

export function normalizeOnboardingDraftPayload(rawPayload: any, neutralInitialState: any): any {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return neutralInitialState;
  }

  const p = rawPayload;
  const result = { ...neutralInitialState };

  result.dormitoryName = (p.dormitoryName ?? p.dormName ?? p.name ?? neutralInitialState.dormitoryName ?? '').toString();
  result.address = (p.address ?? p.dormAddress ?? p.addressLine1 ?? neutralInitialState.address ?? '').toString();
  result.province = (p.province ?? neutralInitialState.province ?? '').toString();
  result.dormType = (p.dormType ?? p.dormitoryType ?? p.type ?? neutralInitialState.dormType ?? 'อพาร์ตเมนต์').toString();
  result.genderType = (p.genderType ?? p.genderPolicy ?? neutralInitialState.genderType ?? 'รวม').toString();
  result.phone = (p.phone ?? neutralInitialState.phone ?? '').toString();
  result.email = (p.email ?? neutralInitialState.email ?? '').toString();

  if (Array.isArray(p.buildings) && p.buildings.length > 0) {
    result.buildings = p.buildings.map((b: any, idx: number) => {
      const bObj = (b && typeof b === 'object') ? b : {};
      const rawRates = bObj.rentRates || {};

      const monthly = parseNum(rawRates.monthly ?? bObj.monthlyRent ?? bObj.monthly, 0);
      const daily = parseNum(rawRates.daily ?? bObj.dailyRent ?? bObj.daily, 0);
      const term = parseNum(rawRates.term ?? bObj.termRent ?? bObj.term, 0);
      const termMonths = parseNum(rawRates.termMonths ?? bObj.termMonths, 6);
      const maxOccupants = parseNum(rawRates.maxOccupants ?? bObj.maxOccupants ?? bObj.maximumOccupants, 2);

      const totalFloors = parseNum(bObj.totalFloors ?? bObj.floorsCount ?? bObj.floorCount, 1);
      const roomsPerFloor = parseNum(bObj.roomsPerFloor ?? bObj.roomsCount, 0);
      const securityDeposit = parseNum(bObj.securityDeposit ?? bObj.depositAmount, 0);

      const buildingCode = (bObj.code ?? bObj.buildingCode ?? bObj.name?.replace(/^อาคาร\s*/, '') ?? String.fromCharCode(65 + idx)).toString();

      return {
        id: (bObj.id ?? `b-${idx + 1}`).toString(),
        name: buildingCode,
        totalFloors: Math.max(1, totalFloors),
        roomsPerFloor: Math.max(0, roomsPerFloor),
        formatPattern: (bObj.formatPattern ?? bObj.numberingPattern ?? 'prefix_floor_room').toString(),
        mode: (bObj.mode ?? 'auto').toString(),
        customRooms: Array.isArray(bObj.customRooms) ? bObj.customRooms : [],
        securityDeposit,
        rentRates: {
          monthly,
          daily,
          term,
          termMonths: Math.max(1, termMonths),
          maxOccupants: Math.max(1, maxOccupants),
        },
      };
    });
  }

  const rawUtil = (p.utilities && typeof p.utilities === 'object') ? p.utilities : {};
  result.utilities = {
    waterBillingMode: (rawUtil.waterBillingMode ?? neutralInitialState.utilities?.waterBillingMode ?? 'unit').toString(),
    waterRate: parseNum(rawUtil.waterRate, neutralInitialState.utilities?.waterRate ?? 18),
    electricBillingMode: (rawUtil.electricBillingMode ?? neutralInitialState.utilities?.electricBillingMode ?? 'unit').toString(),
    electricRate: parseNum(rawUtil.electricRate, neutralInitialState.utilities?.electricRate ?? 7),
    commonFeeMode: (rawUtil.commonFeeMode ?? neutralInitialState.utilities?.commonFeeMode ?? 'none').toString(),
    commonFeeRate: parseNum(rawUtil.commonFeeRate, neutralInitialState.utilities?.commonFeeRate ?? 0),
    internetFeeMode: (rawUtil.internetFeeMode ?? neutralInitialState.utilities?.internetFeeMode ?? 'none').toString(),
    internetRate: parseNum(rawUtil.internetRate, neutralInitialState.utilities?.internetRate ?? 0),
    parkingFeeMode: (rawUtil.parkingFeeMode ?? neutralInitialState.utilities?.parkingFeeMode ?? 'none').toString(),
    parkingFeeRate: parseNum(rawUtil.parkingFeeRate, neutralInitialState.utilities?.parkingFeeRate ?? 0),
  };

  const rawDep = (p.deposits && typeof p.deposits === 'object') ? p.deposits : {};
  result.deposits = {
    securityDeposit: parseNum(rawDep.securityDeposit, neutralInitialState.deposits?.securityDeposit ?? 0),
    advanceRentMonths: parseNum(rawDep.advanceRentMonths, neutralInitialState.deposits?.advanceRentMonths ?? 1),
    dueDateDay: parseNum(rawDep.dueDateDay, neutralInitialState.deposits?.dueDateDay ?? 5),
    gracePeriodDays: parseNum(rawDep.gracePeriodDays, neutralInitialState.deposits?.gracePeriodDays ?? 0),
    lateFeeType: (rawDep.lateFeeType ?? neutralInitialState.deposits?.lateFeeType ?? 'none').toString(),
    lateFeeAmount: parseNum(rawDep.lateFeeAmount, neutralInitialState.deposits?.lateFeeAmount ?? 0),
  };

  const rawPayAcc = (p.paymentAccount && typeof p.paymentAccount === 'object') ? p.paymentAccount : {};
  result.paymentAccount = {
    cashAccepted: p.paymentAccount?.cashAccepted ?? true,
    bankName: (rawPayAcc.bankName ?? rawPayAcc.bankCode ?? neutralInitialState.paymentAccount?.bankName ?? '').toString(),
    accountNumber: (rawPayAcc.accountNumber ?? rawPayAcc.bankAccountNumber ?? neutralInitialState.paymentAccount?.accountNumber ?? '').toString(),
    accountName: (rawPayAcc.accountName ?? rawPayAcc.bankAccountName ?? neutralInitialState.paymentAccount?.accountName ?? '').toString(),
    bankAccountName: (rawPayAcc.bankAccountName ?? rawPayAcc.accountName ?? neutralInitialState.paymentAccount?.bankAccountName ?? '').toString(),
    promptPayId: (rawPayAcc.promptPayId ?? rawPayAcc.promptPayValue ?? neutralInitialState.paymentAccount?.promptPayId ?? '').toString(),
  };

  // Rules & Pet Policy
  if (p.rules || p.defaultTerms) {
    result.defaultTerms = (p.defaultTerms ?? p.rules ?? neutralInitialState.defaultTerms ?? '').toString();
  }
  if (p.petPolicy && typeof p.petPolicy === 'object') {
    result.petPolicy = {
      allowed: p.petPolicy.allowed || 'none',
      allowedTypes: Array.isArray(p.petPolicy.allowedTypes) ? p.petPolicy.allowedTypes : [],
    };
  }

  return result;
}

class OnboardingErrorBoundary extends Component<any, any> {
  public state = { hasError: false };
  public props: any;

  constructor(props: any) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Onboarding UI Render Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl p-6 shadow-sm border border-slate-200 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-800">ไม่สามารถแสดงข้อมูลขั้นตอนนี้ได้</h2>
            <p className="text-slate-500 text-sm">เกิดข้อผิดพลาดในการแสดงผล กรุณาลองรีเฟรชหน้าเว็บ</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-all"
            >
              รีเฟรชหน้าเว็บ
            </button>
          </div>
        </div>
      );
    }
    return this.props?.children;
  }
}

export const OwnerRegister: React.FC<RegisterProps> = (props) => {
  return (
    <OnboardingErrorBoundary>
      <OwnerRegisterInner {...props} />
    </OnboardingErrorBoundary>
  );
};

const OwnerRegisterInner: React.FC<RegisterProps> = ({ onAddLog }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setIsSavedSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Terms & Referral Modal states
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [referralSource, setReferralSource] = useState('facebook');
  const [referralOtherText, setReferralOtherText] = useState('');

  // Room editing states
  const [editingRoom, setEditingRoom] = useState<{ bIdx: number; oldRoom: string; newRoom: string } | null>(null);
  const [bulkEditingBuildingIdx, setBulkEditingBuildingIdx] = useState<number | null>(null);
  const [bulkRoomsInputText, setBulkRoomsInputText] = useState<string>('');

  // Provisional State
  const [provisionalDormitoryId, setProvisionalDormitoryId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  // Step 5: Signature States
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const hasDrawnRef = useRef(false);
  const [signatureSaved, setSignatureSaved] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [savedSignatureDataUrl, setSavedSignatureDataUrl] = useState<string | null>(null);
  const [isEditingSignature, setIsEditingSignature] = useState(false);

  // Step 6: LINE OA States
  const [lineChannelId, setLineChannelId] = useState('');
  const [lineChannelSecret, setLineChannelSecret] = useState('');
  const [lineOaId, setLineOaId] = useState('');
  const [lineVerifying, setLineVerifying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [showLineHelpModal, setShowLineHelpModal] = useState(false);
  const [lineStatus, setLineStatus] = useState<{
    credentialsVerified: boolean;
    webhookEndpointSet: boolean;
    webhookTestSucceeded: boolean;
    webhookActive: boolean;
    isReady: boolean;
    isPublicWebhookConfigured?: boolean;
    webhookOriginError?: string | null;
    botUserId?: string | null;
    botDisplayName?: string | null;
    botPictureUrl?: string | null;
    botPremiumId?: string | null;
    botChatMode?: string | null;
  }>({
    credentialsVerified: false,
    webhookEndpointSet: false,
    webhookTestSucceeded: false,
    webhookActive: false,
    isReady: false,
    isPublicWebhookConfigured: false,
  });

  // Step 7: Package & Catalog States
  const [catalogPackages, setCatalogPackages] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selectedPlanCode, setSelectedPlanCode] = useState<'FREE' | 'PAID'>('FREE');
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromoResult, setAppliedPromoResult] = useState<any>(null);

  // Form Data State
  const [formData, setFormData] = useState({
    // Step 1: Dorm Info
    dormitoryName: '',
    address: '',
    province: '',
    dormType: 'อพาร์ตเมนต์',
    genderType: 'รวม',
    phone: '',
    email: '',

    // Step 2: Flexible Structure
    buildings: [
      {
        id: 'b-1',
        name: 'A', // Building code input e.g. "A" -> Header shows "อาคาร A"
        totalFloors: 1,
        roomsPerFloor: 0,
        formatPattern: 'prefix_floor_room',
        mode: 'auto' as 'auto' | 'manual',
        customRooms: [] as string[],
        securityDeposit: 0,
        rentRates: {
          monthly: 0,
          term: 0,
          termMonths: 1,
          daily: 0,
          maxOccupants: 2
        }
      }
    ],

    // Step 3: Utilities & Service Rates
    utilities: {
      waterBillingMode: 'unit',
      waterRate: 18,
      electricBillingMode: 'unit',
      electricRate: 7,
      commonFeeMode: 'none',
      commonFeeRate: 0,
      internetFeeMode: 'none',
      internetRate: 0,
      parkingFeeMode: 'none',
      parkingFeeRate: 0
    },

    // Step 4: Deposits, Billing & Payment Account
    deposits: {
      securityDeposit: 0,
      advanceRentMonths: 1,
      dueDateDay: 5,
      gracePeriodDays: 0,
      lateFeeType: 'none',
      lateFeeAmount: 0
    },

    paymentAccount: {
      cashAccepted: true,
      bankName: '',
      accountNumber: '',
      accountName: '',
      bankAccountName: '',
      promptPayId: ''
    },

    // Step 5: Rules & Pet Policy
    defaultTerms: RULE_PRESETS.join('\n'),
    petPolicy: {
      allowed: 'none' as 'none' | 'conditional',
      allowedTypes: [] as string[],
    }
  });

  // Room generation helper
  const getGeneratedRooms = (b: {
    totalFloors: number;
    roomsPerFloor: number;
    name: string; // Used as building code prefix
    formatPattern: string;
    mode: 'auto' | 'manual';
    customRooms?: string[];
  }) => {
    if (b.customRooms && b.customRooms.length === 1 && b.customRooms[0] === '__EMPTY__') {
      return [];
    }
    if (b.mode === 'manual' && b.customRooms && b.customRooms.length > 0) {
      return b.customRooms.filter(r => r !== '__EMPTY__');
    }
    if (b.mode === 'auto' && b.customRooms && b.customRooms.length > 0) {
      return b.customRooms.filter(r => r !== '__EMPTY__');
    }

    const rooms: string[] = [];
    const prefix = b.name ? b.name.trim() : '';

    for (let floor = 1; floor <= (b.totalFloors || 0); floor++) {
      for (let rm = 1; rm <= (b.roomsPerFloor || 0); rm++) {
        const rmStr = rm < 10 ? `0${rm}` : `${rm}`;
        let roomNum = '';

        switch (b.formatPattern) {
          case 'prefix_floor_room': // A101
            roomNum = `${prefix}${floor}${rmStr}`;
            break;
          case 'floor_room': // 101
            roomNum = `${floor}${rmStr}`;
            break;
          case 'prefix_floor_slash_room': // A1/1
            roomNum = `${prefix}${floor}/${rm}`;
            break;
          case 'floor_slash_room': // 1/1
            roomNum = `${floor}/${rm}`;
            break;
          case 'prefix_dash_floor_room': // A-101
            roomNum = `${prefix ? `${prefix}-` : ''}${floor}${rmStr}`;
            break;
          default:
            roomNum = `${prefix}${floor}${rmStr}`;
        }
        rooms.push(roomNum);
      }
    }
    return rooms;
  };

  // Building manipulation methods with instant auto-regeneration
  const handleAddBuilding = () => {
    const nextIdx = formData.buildings.length + 1;
    const nextCode = String.fromCharCode(64 + nextIdx);
    const newBuilding = {
      id: `b-${Date.now()}`,
      name: nextCode,
      totalFloors: 1,
      roomsPerFloor: 0,
      formatPattern: 'prefix_floor_room',
      mode: 'auto' as 'auto' | 'manual',
      customRooms: [] as string[],
      securityDeposit: formData.deposits.securityDeposit || 0,
      rentRates: {
        monthly: 0,
        term: 0,
        termMonths: 1,
        daily: 0,
        maxOccupants: 2
      }
    };
    setFormData({ ...formData, buildings: [...formData.buildings, newBuilding] });
  };

  const handleRemoveBuilding = (id: string) => {
    if (formData.buildings.length <= 1) return;
    setFormData({
      ...formData,
      buildings: formData.buildings.filter(b => b.id !== id)
    });
  };

  // When structural inputs change, discard manual customRooms automatically
  const handleBuildingStructureChange = (
    bIdx: number,
    updates: Partial<{ totalFloors: number; roomsPerFloor: number; name: string; formatPattern: string; maxOccupants: number }>
  ) => {
    const updated = [...formData.buildings];
    const target = { ...updated[bIdx] };

    if (updates.totalFloors !== undefined) target.totalFloors = updates.totalFloors;
    if (updates.roomsPerFloor !== undefined) target.roomsPerFloor = updates.roomsPerFloor;
    if (updates.name !== undefined) target.name = updates.name;
    if (updates.formatPattern !== undefined) target.formatPattern = updates.formatPattern;
    if (updates.maxOccupants !== undefined) {
      target.rentRates = { ...target.rentRates, maxOccupants: updates.maxOccupants };
    }

    // Discard any manual customRooms immediately on structural update
    target.customRooms = [];
    target.mode = 'auto';

    updated[bIdx] = target;
    setFormData({ ...formData, buildings: updated });
  };

  const handleRemoveSingleRoom = (bIdx: number, roomNum: string) => {
    const b = formData.buildings[bIdx];
    const currentList = getGeneratedRooms(b);
    const filtered = currentList.filter(r => r !== roomNum);
    const updated = [...formData.buildings];
    updated[bIdx].customRooms = filtered.length === 0 ? ['__EMPTY__'] : filtered;
    setFormData({ ...formData, buildings: updated });
  };

  const handleOpenBulkEdit = (bIdx: number) => {
    const b = formData.buildings[bIdx];
    const roomList = getGeneratedRooms(b);
    setBulkEditingBuildingIdx(bIdx);
    setBulkRoomsInputText(roomList.join(', '));
  };

  const handleResetBuildingRooms = (bIdx: number) => {
    const updated = [...formData.buildings];
    updated[bIdx].customRooms = [];
    updated[bIdx].mode = 'auto';
    setFormData({ ...formData, buildings: updated });
    setBulkEditingBuildingIdx(null);
  };

  const handleSaveBulkEdit = (bIdx: number) => {
    const text = bulkRoomsInputText || '';
    const parsed = text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const updated = [...formData.buildings];
    updated[bIdx].customRooms = parsed.length === 0 ? ['__EMPTY__'] : parsed;
    updated[bIdx].mode = 'manual';
    setFormData({ ...formData, buildings: updated });
    setBulkEditingBuildingIdx(null);
    setBulkRoomsInputText('');
  };

  const handleSaveSingleRoomEdit = () => {
    if (!editingRoom) return;
    const { bIdx, oldRoom, newRoom } = editingRoom;
    const trimmed = newRoom.trim();
    if (!trimmed) {
      setEditingRoom(null);
      return;
    }

    const b = formData.buildings[bIdx];
    const currentList = getGeneratedRooms(b);
    const updatedList = currentList.map(r => (r === oldRoom ? trimmed : r));

    const updated = [...formData.buildings];
    updated[bIdx].customRooms = updatedList;
    updated[bIdx].mode = 'manual';
    setFormData({ ...formData, buildings: updated });
    setEditingRoom(null);
  };

  // Fetch Public Catalog & Draft on Mount
  useEffect(() => {
    onboardingClient.getPublicCatalog()
      .then((res: any) => {
        const raw = res.data || res;
        const pkgs = Array.isArray(raw) ? raw : (raw.data || raw.packages || raw.catalog || []);
        setCatalogPackages(pkgs);
      })
      .catch(() => {})
      .finally(() => {
        setCatalogLoading(false);
      });

    onboardingClient.getDraft()
      .then(async (res: any) => {
        const draft = res.data || res;
        if (draft && draft.payload && !draft.finalizedAt) {
          setFormData(prev => normalizeOnboardingDraftPayload(draft.payload, prev));
          if (draft.provisionalDormitoryId) {
            setProvisionalDormitoryId(draft.provisionalDormitoryId);
            const isSigSaved = Boolean(draft.signatureSaved || draft.payload?.signatureSaved);
            setSignatureSaved(isSigSaved);
            if (isSigSaved) {
              setSavedSignatureDataUrl(`/api/v1/dormitories/${draft.provisionalDormitoryId}/signatures?t=${Date.now()}`);
            }
            try {
              const lineRes = await onboardingClient.getLineConfig(draft.provisionalDormitoryId);
              const raw = lineRes.data || lineRes;
              const config = raw.config || raw;
              const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
              const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
              const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
              const webhookActive = Boolean(config.webhookActive);
              const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

              setLineChannelId(config.channelId || '');
              if (config.lineOaId) setLineOaId(config.lineOaId);
              if (config.webhookUrl) setWebhookUrl(config.webhookUrl);

              setLineStatus({
                credentialsVerified,
                webhookEndpointSet,
                webhookTestSucceeded,
                webhookActive,
                isReady,
                isPublicWebhookConfigured: Boolean(config.isPublicWebhookConfigured),
                webhookOriginError: config.webhookOriginError || null,
                botUserId: config.botUserId || null,
                botDisplayName: config.botDisplayName || null,
                botPictureUrl: config.botPictureUrl || null,
                botPremiumId: config.botPremiumId || null,
                botChatMode: config.botChatMode || null,
              });
            } catch {}
          }
        }
      })
      .catch(() => {});
  }, []);

  // Canvas Drawing Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    hasDrawnRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    setSignatureSaved(false);
    setSavedSignatureDataUrl(null);
  };

  const ensureProvisionalDormitory = async (): Promise<string | null> => {
    if (provisionalDormitoryId) return provisionalDormitoryId;
    try {
      const res = await onboardingClient.prepare({
        name: formData.dormitoryName.trim() || 'หอพักใหม่',
        addressLine1: formData.address.trim() || undefined,
        province: formData.province.trim() || undefined,
      });
      const provId = res.data?.provisionalDormitoryId || res.provisionalDormitoryId;
      if (provId) {
        setProvisionalDormitoryId(provId);
        if (res.data?.webhookUrl || res.webhookUrl) {
          setWebhookUrl(res.data?.webhookUrl || res.webhookUrl);
        }
        return provId;
      }
    } catch (err: any) {
      setValidationError(err.message || 'ไม่สามารถเตรียมข้อมูลหอพักชั่วคราวได้');
    }
    return null;
  };

  // Save Signature
  const handleSaveSignature = async () => {
    if (!hasDrawnRef.current) {
      setValidationError('กรุณาวาดลายเซ็นก่อนกดบันทึก');
      return;
    }

    const dormId = await ensureProvisionalDormitory();
    if (!dormId) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    setSignatureUploading(true);
    setValidationError(null);

    try {
      await onboardingClient.uploadSignature(dormId, dataUrl);
      setSignatureSaved(true);
      setSavedSignatureDataUrl(dataUrl);
      setIsEditingSignature(false);
      onAddLog?.('UPLOAD_SIGNATURE', `บันทึกลายเซ็นเจ้าของหอพักสำหรับ provisionalDormitoryId: ${dormId}`, 'ONBOARDING');
    } catch (err: any) {
      setValidationError(err.message || 'การบันทึกลายเซ็นล้มเหลว กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSignatureUploading(false);
    }
  };

  // Step 6: Verify LINE Credentials
  const handleVerifyLineCredentials = async () => {
    if (!lineChannelId.trim() || !lineChannelSecret.trim()) {
      setValidationError('กรุณากรอก Channel ID และ Channel Secret ให้ครบถ้วน');
      return;
    }

    const dormId = await ensureProvisionalDormitory();
    if (!dormId) return;

    setLineVerifying(true);
    setValidationError(null);

    try {
      const res = await onboardingClient.updateLineConfig(dormId, {
        channelId: lineChannelId.trim(),
        channelSecret: lineChannelSecret.trim(),
      });

      const raw = res.data || res;
      const config = raw.config || raw;
      const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
      const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
      const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      setLineStatus({
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        isReady,
        isPublicWebhookConfigured: Boolean(config.isPublicWebhookConfigured),
        webhookOriginError: config.webhookOriginError || null,
        botUserId: config.botUserId || null,
        botDisplayName: config.botDisplayName || null,
        botPictureUrl: config.botPictureUrl || null,
        botPremiumId: config.botPremiumId || null,
        botChatMode: config.botChatMode || null,
      });

      if (config.lineOaId) {
        setLineOaId(config.lineOaId);
      }
      if (config.webhookUrl) {
        setWebhookUrl(config.webhookUrl);
      }
    } catch (err: any) {
      setValidationError(err.message || 'การตรวจสอบ LINE Credentials ล้มเหลว');
    } finally {
      setLineVerifying(false);
    }
  };

  // Step 7: Apply Promo
  const handleApplyPromoCode = async () => {
    if (!promoCodeInput.trim()) {
      setPromoError('กรุณาระบุรหัสโปรโมชัน');
      return;
    }
    setPromoApplying(true);
    setPromoError(null);
    setPromoSuccess(null);

    try {
      const res = await onboardingClient.validatePromo(promoCodeInput.trim());
      const raw = res.data || res;
      if (raw.valid && raw.eligible) {
        setAppliedPromoResult(raw);
        setPromoSuccess(`ใช้รหัสโปรโมชัน "${raw.code}" สำเร็จ! รับสิทธิ์ใช้งานเพิ่มเติม ${raw.promoBonusMonths || 2} เดือน`);
      } else {
        setPromoError(raw.message || 'รหัสโปรโมชันไม่ถูกต้องหรือถูกใช้งานแล้ว');
      }
    } catch (err: any) {
      setPromoError(err.message || 'ไม่สามารถตรวจสอบรหัสโปรโมชันได้');
    } finally {
      setPromoApplying(false);
    }
  };

  // Validation before step change
  const validateStep = (stepNum: number): { valid: boolean; error?: string } => {
    if (stepNum === 1) {
      if (!formData.dormitoryName.trim()) {
        return { valid: false, error: 'กรุณากรอก "ชื่อหอพัก / อพาร์ตเมนต์"' };
      }
      if (!formData.address.trim()) {
        return { valid: false, error: 'กรุณากรอก "ที่อยู่หอพัก"' };
      }
      if (!formData.province.trim()) {
        return { valid: false, error: 'กรุณาเลือก "จังหวัด"' };
      }
      if (!formData.dormType.trim()) {
        return { valid: false, error: 'กรุณาเลือก "ประเภทที่พัก"' };
      }
      if (!formData.genderType.trim()) {
        return { valid: false, error: 'กรุณาเลือก "นโยบายผู้เข้าพัก"' };
      }
      if (formData.phone && formData.phone.replace(/\D/g, '').length < 9) {
        return { valid: false, error: 'กรุณากรอกเบอร์โทรศัพท์ติดต่อให้ครบถ้วน' };
      }
    }

    if (stepNum === 2) {
      if (!formData.buildings || formData.buildings.length === 0) {
        return { valid: false, error: 'กรุณาเพิ่มอาคารอย่างน้อย 1 อาคาร' };
      }
      for (let i = 0; i < formData.buildings.length; i++) {
        const b = formData.buildings[i];
        const bLabel = b.name ? `อาคาร ${b.name}` : `อาคารที่ ${i + 1}`;

        if (!b.totalFloors || b.totalFloors <= 0) {
          return { valid: false, error: `กรุณากรอก "จำนวนชั้น" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
        }
        if (!b.roomsPerFloor || b.roomsPerFloor <= 0) {
          return { valid: false, error: `กรุณากรอก "ห้องต่อชั้น" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
        }

        const rooms = getGeneratedRooms(b);
        if (rooms.length === 0) {
          return { valid: false, error: `${bLabel} ยังไม่มีเลขห้องพัก กรุณาสร้างอัตโนมัติหรือระบุเลขห้อง` };
        }
      }
    }

    if (stepNum === 3) {
      if (isNaN(Number(formData.utilities.waterRate)) || Number(formData.utilities.waterRate) < 0) {
        return { valid: false, error: 'กรุณากรอก "ค่าน้ำประปา" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
      }
      if (isNaN(Number(formData.utilities.electricRate)) || Number(formData.utilities.electricRate) < 0) {
        return { valid: false, error: 'กรุณากรอก "ค่าไฟฟ้า" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
      }
    }

    if (stepNum === 4) {
      if (!formData.paymentAccount.bankName) {
        return { valid: false, error: 'กรุณาเลือก "ธนาคารที่รับโอน"' };
      }
      if (!formData.paymentAccount.accountNumber.trim()) {
        return { valid: false, error: 'กรุณากรอก "เลขที่บัญชีธนาคาร"' };
      }
      const cleanAcc = formData.paymentAccount.accountNumber.replace(/\D/g, '');
      if (cleanAcc.length < 8) {
        return { valid: false, error: 'กรุณากรอก "เลขที่บัญชีธนาคาร" ให้ครบถ้วน (อย่างน้อย 8 หลัก)' };
      }
      const bankAccName = formData.paymentAccount.bankAccountName || formData.paymentAccount.accountName;
      if (!bankAccName || !bankAccName.trim()) {
        return { valid: false, error: 'กรุณากรอก "ชื่อบัญชีธนาคาร"' };
      }
    }

    if (stepNum === 5) {
      if (!signatureSaved && !savedSignatureDataUrl) {
        return { valid: false, error: 'กรุณากด "บันทึกลายเซ็นเจ้าของหอพัก" ก่อนดำเนินการต่อ' };
      }
    }

    return { valid: true };
  };

  // Step Navigation
  const handleNextStep = async () => {
    const check = validateStep(currentStep);
    if (!check.valid) {
      setValidationError(check.error || 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setValidationError(null);

    const nextStepNum = currentStep + 1;
    if (currentStep === 4) {
      await ensureProvisionalDormitory();
    }
    setCurrentStep(nextStepNum);

    onboardingClient.saveDraft(String(nextStepNum), {
      ...formData,
      signatureSaved: signatureSaved || Boolean(savedSignatureDataUrl),
    }, provisionalDormitoryId || undefined).catch(() => {});
  };

  const handlePrevStep = () => {
    setValidationError(null);
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleOpenTermsModal = () => {
    const check = validateStep(currentStep);
    if (!check.valid) {
      setValidationError(check.error || 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setValidationError(null);
    setShowTermsModal(true);
  };

  // Finalize Owner Onboarding
  const handleFinalize = async () => {
    if (isSubmitting) return;
    if (!agreedTerms) {
      setValidationError('กรุณากดยินยอมรับเงื่อนไขและข้อบังคับก่อนดำเนินการต่อ');
      return;
    }
    if (!referralSource) {
      setValidationError('กรุณาเลือกช่องทางที่คุณรู้จัก HorPlus');
      return;
    }
    if (referralSource === 'other' && !referralOtherText.trim()) {
      setValidationError('กรุณาระบุช่องทางอื่นๆ ที่รู้จัก HorPlus');
      return;
    }

    setValidationError(null);
    setIsSubmitting(true);

    try {
      const buildingsPayload: any[] = [];
      const roomsPayload: any[] = [];

      formData.buildings.forEach((b, bIdx) => {
        const bId = b.id || `bld-${bIdx + 1}`;
        const bName = b.name ? `อาคาร ${b.name.trim()}` : `อาคาร ${bIdx + 1}`;
        buildingsPayload.push({
          id: bId,
          name: bName,
          floorsCount: b.totalFloors || 1,
          roomsPerFloor: b.roomsPerFloor || 0,
          roomPrefix: b.name || null,
          numberingPattern: b.formatPattern || 'prefix_floor_room',
          monthlyRent: b.rentRates?.monthly ?? 0,
          dailyRent: b.rentRates?.daily ?? 0,
          termRent: b.rentRates?.term ?? 0,
          termMonths: b.rentRates?.termMonths ?? 6,
          maximumOccupants: b.rentRates?.maxOccupants ?? 2,
        });

        const roomNumbers = getGeneratedRooms(b);
        const monthlyRent = b.rentRates?.monthly ?? 0;
        const deposit = b.securityDeposit !== undefined ? b.securityDeposit : (formData.deposits.securityDeposit ?? 0);

        roomNumbers.forEach((rNum) => {
          const digitsOnly = rNum.replace(/\D/g, '');
          const calculatedFloor = digitsOnly ? (parseInt(digitsOnly.charAt(0)) || 1) : 1;

          roomsPayload.push({
            buildingId: bId,
            roomNumber: rNum,
            floor: calculatedFloor,
            monthlyRent: Number(monthlyRent) || 0,
            depositAmount: Number(deposit) || 0,
            parkingFee: Number(formData.utilities.parkingFeeRate) || 0,
            maximumOccupants: Number(b.rentRates?.maxOccupants) || 2,
            initialWaterReading: 0,
            initialElectricityReading: 0,
            status: 'vacant',
          });
        });
      });

      const rawPromptPayDigits = (formData.paymentAccount.promptPayId || '').replace(/\D/g, '');
      let promptPayType: 'mobile_phone' | 'national_id' | undefined = undefined;
      let promptPayValue: string | undefined = undefined;

      if (rawPromptPayDigits.length === 10) {
        promptPayType = 'mobile_phone';
        promptPayValue = rawPromptPayDigits;
      } else if (rawPromptPayDigits.length === 13) {
        promptPayType = 'national_id';
        promptPayValue = rawPromptPayDigits;
      }

      const payload: CompleteOnboardingPayload = {
        provisionalDormitoryId: provisionalDormitoryId || undefined,
        dormitory: {
          name: formData.dormitoryName.trim(),
          type: formData.dormType || 'apartment',
          genderPolicy: formData.genderType || 'รวม',
          addressLine1: formData.address.trim(),
          province: formData.province.trim(),
          estimatedBuildingCount: formData.buildings.length,
          estimatedRoomCount: roomsPayload.length,
        },
        billing: {
          billingDay: 25,
          dueDay: Number(formData.deposits.dueDateDay) || 5,
          waterBillingType: formData.utilities.waterBillingMode === 'flat' ? 'flat_rate' : 'per_unit',
          waterRate: String(formData.utilities.waterRate ?? 18),
          electricityBillingType: formData.utilities.electricBillingMode === 'flat' ? 'flat_rate' : 'per_unit',
          electricityRate: String(formData.utilities.electricRate ?? 7),
          commonFee: String(formData.utilities.commonFeeRate ?? 0),
          commonFeeMode: formData.utilities.commonFeeMode || 'none',
          internetFee: String(formData.utilities.internetRate ?? 0),
          internetFeeMode: formData.utilities.internetFeeMode || 'none',
          parkingRate: String(formData.utilities.parkingFeeRate ?? 0),
          parkingFeeMode: formData.utilities.parkingFeeMode || 'none',
          gracePeriodDays: Number(formData.deposits.gracePeriodDays) || 0,
          advanceRentMonths: Number(formData.deposits.advanceRentMonths) || 1,
          lateFeeType: (formData.deposits.lateFeeType as any) || 'none',
          lateFeeValue: String(formData.deposits.lateFeeAmount ?? 0),
          rentBillingType: 'monthly',
        },
        payment: {
          cashAccepted: formData.paymentAccount.cashAccepted,
          promptPayType,
          promptPayValue,
          bankCode: formData.paymentAccount.bankName || undefined,
          bankAccountName: (formData.paymentAccount.bankAccountName || formData.paymentAccount.accountName || '').trim() || undefined,
          bankAccountNumber: formData.paymentAccount.accountNumber.trim() || undefined,
        },
        buildings: buildingsPayload,
        rooms: roomsPayload,
        planCode: selectedPlanCode,
        packageId: selectedPackageId || undefined,
        promoCode: appliedPromoResult ? appliedPromoResult.code : (promoCodeInput.trim() || undefined),
        defaultTerms: formData.defaultTerms,
        petPolicy: formData.petPolicy,
      };

      await onboardingClient.finalize(payload);

      onAddLog?.('FINALIZE_ONBOARDING', `สร้างและลงทะเบียนหอพัก "${formData.dormitoryName}" สำเร็จ`, 'ONBOARDING');
      setIsSavedSuccess(true);
      setShowTermsModal(false);

      setTimeout(() => {
        window.location.href = '/owner/dashboard';
      }, 1200);
    } catch (err: any) {
      setValidationError(err.message || 'เกิดข้อผิดพลาดในการลงทะเบียนหอพัก กรุณาตรวจสอบข้อมูลอีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  // Steps Definition List
  const stepsList = [
    { num: 1, name: 'ข้อมูลหอพัก', icon: Building2 },
    { num: 2, name: 'อาคาร & ผังห้อง', icon: BuildingIcon },
    { num: 3, name: 'ค่าเช่า & ค่าน้ำไฟ', icon: Zap },
    { num: 4, name: 'มัดจำ & บัญชี', icon: CreditCard },
    { num: 5, name: 'กฎระเบียบ & สัญญา', icon: FileSignature },
    { num: 6, name: 'เชื่อมต่อ LINE OA', icon: MessageSquare },
    { num: 7, name: 'เลือกแพ็กเกจ', icon: Sparkles },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16 font-sans">
      {/* Top Header */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white py-8 px-4 shadow-md mb-8">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/20">
              <Building2 className="w-8 h-8 text-blue-200" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">ระบบลงทะเบียนหอพัก HorPlus</h1>
              <p className="text-blue-200 text-sm mt-0.5">กรอกข้อมูล 7 ขั้นตอนเพื่อเริ่มต้นใช้งานระบบบริหารจัดการหอพักมืออาชีพ</p>
            </div>
          </div>
          <div className="hidden md:block text-right">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-500/30 text-blue-100 border border-blue-400/30">
              ขั้นตอนที่ {currentStep} จาก 7
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4">
        {/* Step Indicator Bar */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 mb-8 overflow-x-auto">
          <div className="flex items-center justify-between min-w-[700px]">
            {stepsList.map((st, idx) => {
              const Icon = st.icon;
              const isActive = currentStep === st.num;
              const isDone = currentStep > st.num;
              return (
                <React.Fragment key={st.num}>
                  {idx > 0 && (
                    <div className={`flex-1 h-0.5 mx-1.5 ${isDone ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                  )}
                  <button
                    onClick={() => {
                      if (st.num < currentStep) {
                        setCurrentStep(st.num);
                        setValidationError(null);
                      }
                    }}
                    disabled={st.num > currentStep}
                    className={`flex flex-col items-center gap-1 px-1.5 py-1 rounded-xl transition-all ${
                      isActive
                        ? 'text-indigo-600 font-semibold'
                        : isDone
                        ? 'text-slate-700 cursor-pointer hover:text-indigo-600'
                        : 'text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 scale-105'
                        : isDone
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'bg-slate-100 text-slate-400'
                    }`}>
                      {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <span className="text-[11px] tracking-tight whitespace-nowrap">{st.name}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Validation Error Banner */}
        {validationError && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-700 text-sm shadow-sm animate-fade-in">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{validationError}</div>
            <button onClick={() => setValidationError(null)} className="text-rose-400 hover:text-rose-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* STEP 1: Dormitory Information */}
        {currentStep === 1 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Building2 className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 1: ข้อมูลหอพักทั่วไป
              </h2>
              <p className="text-slate-500 text-sm mt-1">ระบุชื่อ ที่ตั้ง และประเภทของหอพักเพื่อนำไปแสดงในสัญญาและใบเสร็จรับเงิน</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  ชื่อหอพัก / อพาร์ตเมนต์ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  data-testid="input-dorm-name"
                  value={formData.dormitoryName}
                  onChange={e => setFormData(prev => ({ ...prev, dormitoryName: e.target.value }))}
                  placeholder="เช่น สบายดี อพาร์ตเมนต์ หรือ รุ่งเรือง แมนชั่น"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium transition-all"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  ที่อยู่หอพัก <span className="text-rose-500">*</span>
                </label>
                <textarea
                  data-testid="input-dorm-address"
                  rows={3}
                  value={formData.address}
                  onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="ระบุเลขที่ ซอย ถนน ตำบล อำเภอ..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">
                  จังหวัด <span className="text-rose-500">*</span>
                </label>
                <select
                  data-testid="select-province"
                  value={formData.province}
                  onChange={e => setFormData(prev => ({ ...prev, province: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium transition-all bg-white"
                >
                  <option value="">-- เลือกจังหวัด --</option>
                  {PROVINCE_OPTIONS.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">
                  ประเภทที่พัก <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.dormType}
                  onChange={e => setFormData(prev => ({ ...prev, dormType: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium transition-all bg-white"
                >
                  {DORM_TYPE_OPTIONS.map(dt => (
                    <option key={dt} value={dt}>{dt}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">เบอร์โทรศัพท์ติดต่อ</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={e => setFormData(prev => ({ ...prev, phone: formatPhone(e.target.value) }))}
                  placeholder="081-234-5678"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">อีเมลติดต่อ (Optional)</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="owner@example.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-medium"
                />
              </div>

              <div className="space-y-3 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  นโยบายประเภทผู้พัก / เพศ <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {GENDER_TYPE_OPTIONS.map(gt => (
                    <button
                      key={gt.id}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, genderType: gt.id }))}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        formData.genderType === gt.id
                          ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="font-bold text-slate-800 text-sm">{gt.label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{gt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Buildings & Rooms */}
        {currentStep === 2 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <BuildingIcon className="w-6 h-6 text-indigo-600" />
                  ขั้นตอนที่ 2: โครงสร้างอาคารและผังห้องพัก
                </h2>
                <p className="text-slate-500 text-sm mt-1">กำหนดอาคาร จำนวนชั้น ห้องต่อชั้น และรูปแบบหมายเลขห้องพัก (สร้างผังห้องได้ไม่จำกัด)</p>
              </div>
              <button
                type="button"
                data-testid="button-add-building"
                onClick={handleAddBuilding}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-semibold text-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                เพิ่มอาคาร
              </button>
            </div>

            <div className="space-y-6">
              {formData.buildings.map((b, bIdx) => {
                const roomList = getGeneratedRooms(b);
                const buildingHeader = b.name ? `อาคาร ${b.name}` : `อาคารที่ ${bIdx + 1}`;

                return (
                  <div key={b.id} className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-sm flex items-center justify-center">
                          {bIdx + 1}
                        </span>
                        <h3 className="font-bold text-slate-800 text-base">
                          {buildingHeader}
                        </h3>
                      </div>
                      {formData.buildings.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBuilding(b.id)}
                          className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                          ลบอาคาร
                        </button>
                      )}
                    </div>

                    {/* 4 Primary Structural Controls */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-slate-200/80">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">รหัส/ชื่อตึก</label>
                        <input
                          type="text"
                          data-testid="input-building-prefix"
                          value={b.name}
                          onChange={e => handleBuildingStructureChange(bIdx, { name: e.target.value })}
                          placeholder="เช่น A, B, 1"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">จำนวนชั้น</label>
                        <input
                          type="number"
                          data-testid="input-building-total-floors"
                          min={1}
                          max={100}
                          value={b.totalFloors}
                          onChange={e => handleBuildingStructureChange(bIdx, { totalFloors: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">ห้องต่อชั้น</label>
                        <input
                          type="number"
                          data-testid="input-building-rooms-per-floor"
                          min={1}
                          max={100}
                          value={b.roomsPerFloor}
                          onChange={e => handleBuildingStructureChange(bIdx, { roomsPerFloor: Math.max(0, parseInt(e.target.value) || 0) })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">จำนวนผู้พักสูงสุด (คน)</label>
                        <input
                          type="number"
                          data-testid="input-building-max-occupants"
                          min={1}
                          value={b.rentRates?.maxOccupants ?? 2}
                          onChange={e => handleBuildingStructureChange(bIdx, { maxOccupants: Math.max(1, parseInt(e.target.value) || 1) })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
                        />
                      </div>

                      <div className="sm:col-span-2 md:col-span-4">
                        <label className="block text-xs font-semibold text-slate-600 mb-1">รูปแบบหมายเลขห้อง</label>
                        <select
                          data-testid="select-building-format-pattern"
                          value={b.formatPattern}
                          onChange={e => handleBuildingStructureChange(bIdx, { formatPattern: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold bg-white"
                        >
                          <option value="prefix_floor_room">{b.name || 'A'}101 (รหัสตึก+ชั้น+เลขห้อง - แนะนำ)</option>
                          <option value="floor_room">101 (ชั้น+เลขห้อง)</option>
                          <option value="prefix_floor_slash_room">{b.name || 'A'}1/1 (รหัสตึก+ชั้น/เลขห้อง)</option>
                          <option value="floor_slash_room">1/1 (ชั้น/เลขห้อง)</option>
                          <option value="prefix_dash_floor_room">{b.name || 'A'}-101 (รหัสตึก-ชั้น+เลขห้อง)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="text-xs font-semibold text-slate-600">
                        รายการห้องพักที่สร้าง ({roomList.length} ห้อง):
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenBulkEdit(bIdx)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          แก้ไขชุดห้อง
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetBuildingRooms(bIdx)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          รีเซ็ตสร้างอัตโนมัติ
                        </button>
                      </div>
                    </div>

                    {/* Room pills grid */}
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-3 bg-white rounded-xl border border-slate-200/80">
                      {roomList.map(rm => (
                        <div key={rm} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold">
                          <span>{rm}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSingleRoom(bIdx, rm)}
                            className="text-indigo-400 hover:text-rose-600 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: Rent & Utilities */}
        {currentStep === 3 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Zap className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 3: ค่าเช่าและค่าน้ำไฟ / ค่าบริการ
              </h2>
              <p className="text-slate-500 text-sm mt-1">กำหนดอัตราค่าเช่า ค่าน้ำ ค่าไฟ และค่าบริการส่วนกลาง</p>
            </div>

            <div className="space-y-6">
              {/* Card-Style Utilities */}
              <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Droplet className="w-4 h-4 text-blue-600" />
                  อัตราค่าน้ำ ค่าไฟ และค่าบริการส่วนกลาง
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {/* Water */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">ค่าน้ำประปา (บาท/ยูนิต)</label>
                    <input
                      type="number"
                      data-testid="input-water-rate"
                      min={0}
                      value={formData.utilities.waterRate}
                      onChange={e => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, waterRate: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                    />
                  </div>

                  {/* Electricity */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">ค่าไฟฟ้า (บาท/ยูนิต)</label>
                    <input
                      type="number"
                      data-testid="input-electric-rate"
                      min={0}
                      value={formData.utilities.electricRate}
                      onChange={e => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, electricRate: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                    />
                  </div>

                  {/* Common fee */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">ค่าบริการส่วนกลาง (บาท/เดือน)</label>
                    <input
                      type="number"
                      data-testid="input-common-fee-rate"
                      min={0}
                      value={formData.utilities.commonFeeRate}
                      onChange={e => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, commonFeeRate: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                    />
                  </div>

                  {/* Internet */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">ค่าอินเทอร์เน็ต (บาท/เดือน)</label>
                    <input
                      type="number"
                      data-testid="input-internet-fee-rate"
                      min={0}
                      value={formData.utilities.internetRate}
                      onChange={e => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, internetRate: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                    />
                  </div>

                  {/* Parking */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-semibold text-slate-700">ค่าจอดรถ (บาท/เดือน)</label>
                    <input
                      type="number"
                      data-testid="input-parking-fee-rate"
                      min={0}
                      value={formData.utilities.parkingFeeRate}
                      onChange={e => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, parkingFeeRate: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Building Rent Rates */}
              {formData.buildings.map((b, bIdx) => {
                const rentRates = b.rentRates || { monthly: 0, daily: 0, term: 0, termMonths: 6, maxOccupants: 2 };
                return (
                  <div key={b.id} className="p-6 rounded-2xl border border-slate-200 bg-white space-y-4">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                      <BuildingIcon className="w-4 h-4 text-indigo-600" />
                      อัตราค่าเช่าสำหรับ อาคาร {b.name || (bIdx + 1)}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">ค่าเช่ารายเดือน (บาท) *</label>
                        <input
                          type="number"
                          data-testid="input-building-monthly-rent"
                          min={0}
                          value={rentRates.monthly ?? 0}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx] = {
                              ...updated[bIdx],
                              rentRates: { ...rentRates, monthly: Number(e.target.value) }
                            };
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">ค่าเช่ารายวัน (บาท)</label>
                        <input
                          type="number"
                          data-testid="input-building-daily-rent"
                          min={0}
                          value={rentRates.daily ?? 0}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx] = {
                              ...updated[bIdx],
                              rentRates: { ...rentRates, daily: Number(e.target.value) }
                            };
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">ค่าเช่าระยะยาว (บาท)</label>
                        <input
                          type="number"
                          data-testid="input-building-term-rent"
                          min={0}
                          value={rentRates.term ?? 0}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx] = {
                              ...updated[bIdx],
                              rentRates: { ...rentRates, term: Number(e.target.value) }
                            };
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">ระยะเวลาสัญญา (เดือน)</label>
                        <input
                          type="number"
                          data-testid="input-building-term-months"
                          min={1}
                          value={rentRates.termMonths ?? 6}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx] = {
                              ...updated[bIdx],
                              rentRates: { ...rentRates, termMonths: Number(e.target.value) }
                            };
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 4: Deposit & Payment Accounts */}
        {currentStep === 4 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <CreditCard className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 4: เงินมัดจำ รอบบิล และบัญชีรับเงิน
              </h2>
              <p className="text-slate-500 text-sm mt-1">กำหนดเงินประกัน ค่าเช่าล่วงหน้า และข้อมูลบัญชีธนาคารสำหรับรับชำระค่าเช่า</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Deposit & Billing Rules */}
              <div className="space-y-4 md:col-span-2 bg-slate-50/50 p-5 rounded-2xl border border-slate-200">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  เงินประกันและวันครบกำหนดชำระ
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">เงินประกันความเสียหาย (บาท)</label>
                    <input
                      type="number"
                      data-testid="input-security-deposit"
                      min={0}
                      value={formData.deposits.securityDeposit}
                      onChange={e => setFormData(prev => ({ ...prev, deposits: { ...prev.deposits, securityDeposit: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">ค่าเช่าล่วงหน้า (เดือน)</label>
                    <input
                      type="number"
                      data-testid="input-advance-rent-months"
                      min={0}
                      value={formData.deposits.advanceRentMonths}
                      onChange={e => setFormData(prev => ({ ...prev, deposits: { ...prev.deposits, advanceRentMonths: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">วันครบกำหนดชำระ (ของเดือน)</label>
                    <select
                      value={formData.deposits.dueDateDay}
                      onChange={e => setFormData(prev => ({ ...prev, deposits: { ...prev.deposits, dueDateDay: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm bg-white"
                    >
                      {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>วันที่ {d}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">ระยะเวลาผ่อนผัน (วัน)</label>
                    <input
                      type="number"
                      data-testid="input-grace-period-days"
                      min={0}
                      value={formData.deposits.gracePeriodDays}
                      onChange={e => setFormData(prev => ({ ...prev, deposits: { ...prev.deposits, gracePeriodDays: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Payment Accounts */}
              <div className="space-y-4 md:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-indigo-600" />
                    ข้อมูลบัญชีธนาคารสำหรับรับชำระค่าเช่า
                  </h3>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.paymentAccount.cashAccepted}
                      onChange={e => setFormData(prev => ({
                        ...prev,
                        paymentAccount: { ...prev.paymentAccount, cashAccepted: e.target.checked }
                      }))}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>รับชำระด้วยเงินสด</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">ธนาคาร <span className="text-rose-500">*</span></label>
                    <select
                      data-testid="select-bank-name"
                      value={formData.paymentAccount.bankName}
                      onChange={e => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, bankName: e.target.value } }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold bg-white"
                    >
                      <option value="">-- เลือกธนาคาร --</option>
                      {BANK_OPTIONS.map(b => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">เลขที่บัญชีธนาคาร <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      data-testid="input-account-number"
                      value={formData.paymentAccount.accountNumber}
                      onChange={e => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, accountNumber: formatBankAccount(e.target.value) } }))}
                      placeholder="xxx-x-xxxxx-x"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-bold text-slate-800 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">ชื่อบัญชีธนาคาร <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      data-testid="input-account-name"
                      value={formData.paymentAccount.bankAccountName || formData.paymentAccount.accountName}
                      onChange={e => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, bankAccountName: e.target.value, accountName: e.target.value } }))}
                      placeholder="นาย/นาง/นางสาว สมชาย ใจดี"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-800 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">เลขพร้อมเพย์ (PromptPay - Optional)</label>
                    <input
                      type="text"
                      data-testid="input-promptpay"
                      value={formData.paymentAccount.promptPayId}
                      onChange={e => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, promptPayId: e.target.value } }))}
                      placeholder="เบอร์โทร 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-800 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: Rules & Contract & Owner Signature */}
        {currentStep === 5 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <FileSignature className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 5: กฎระเบียบ นโยบายสัตว์เลี้ยง และลายเซ็นเจ้าของหอพัก
              </h2>
              <p className="text-slate-500 text-sm mt-1">กำหนดข้อบังคับหอพัก นโยบายสัตว์เลี้ยง และบันทึกลายเซ็นเพื่อประทับลงในสัญญาเช่า</p>
            </div>

            {/* 1. Pet Policy */}
            <div className="p-5 bg-slate-50/60 border border-slate-200 rounded-2xl space-y-3">
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 text-rose-500" />
                <h3 className="font-bold text-slate-800 text-sm">นโยบายสัตว์เลี้ยง (Pet Policy)</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3.5 rounded-xl border cursor-pointer select-none transition-all ${
                    formData.petPolicy.allowed === 'none'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="petPolicyRadio"
                    checked={formData.petPolicy.allowed === 'none'}
                    onChange={() => setFormData(prev => ({
                      ...prev,
                      petPolicy: { allowed: 'none', allowedTypes: [] }
                    }))}
                    className="sr-only"
                  />
                  <span className="font-bold text-slate-800 text-xs block">ไม่อนุญาตให้เลี้ยงสัตว์</span>
                  <span className="text-[11px] text-slate-500">ห้ามนำสัตว์เลี้ยงทุกชนิดเข้ามาในห้องพัก</span>
                </label>

                <label
                  className={`p-3.5 rounded-xl border cursor-pointer select-none transition-all ${
                    formData.petPolicy.allowed === 'conditional'
                      ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="petPolicyRadio"
                    checked={formData.petPolicy.allowed === 'conditional'}
                    onChange={() => setFormData(prev => ({
                      ...prev,
                      petPolicy: { allowed: 'conditional', allowedTypes: prev.petPolicy.allowedTypes }
                    }))}
                    className="sr-only"
                  />
                  <span className="font-bold text-slate-800 text-xs block">อนุญาตแบบมีเงื่อนไข</span>
                  <span className="text-[11px] text-slate-500">เลือกประเภทสัตว์เลี้ยงที่อนุญาตด้านล่าง</span>
                </label>
              </div>

              {formData.petPolicy.allowed === 'conditional' && (
                <div className="pt-2 p-3 bg-white border border-slate-200 rounded-xl space-y-2">
                  <span className="text-xs font-bold text-slate-700 block">ประเภทสัตว์เลี้ยงที่อนุญาต:</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {[
                      { id: 'dog', label: 'สุนัข' },
                      { id: 'cat', label: 'แมว' },
                      { id: 'small_pet', label: 'สัตว์เล็ก (กระต่าย/หนู)' },
                      { id: 'exotic', label: 'สัตว์แปลก (Exotic)' },
                    ].map(pet => (
                      <label key={pet.id} className="flex items-center gap-2 cursor-pointer select-none text-slate-700 hover:text-slate-900">
                        <input
                          type="checkbox"
                          checked={formData.petPolicy.allowedTypes.includes(pet.id)}
                          onChange={e => {
                            const current = formData.petPolicy.allowedTypes;
                            const next = e.target.checked
                              ? [...current, pet.id]
                              : current.filter(x => x !== pet.id);
                            setFormData(prev => ({
                              ...prev,
                              petPolicy: { ...prev.petPolicy, allowedTypes: next }
                            }));
                          }}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{pet.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 2. Rules Presets & Editor */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  กฎระเบียบและข้อกำหนดหอพัก (Dormitory Rules)
                </h3>
              </div>

              {/* Preset Buttons */}
              <div className="flex flex-wrap gap-1.5">
                {RULE_PRESETS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      if (!formData.defaultTerms.includes(preset)) {
                        setFormData(prev => ({
                          ...prev,
                          defaultTerms: prev.defaultTerms ? `${prev.defaultTerms}\n${preset}` : preset
                        }));
                      }
                    }}
                    className="text-[11px] px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-lg border border-slate-200 transition-colors cursor-pointer"
                  >
                    + {preset.slice(0, 30)}...
                  </button>
                ))}
              </div>

              <textarea
                rows={5}
                value={formData.defaultTerms}
                onChange={e => setFormData(prev => ({ ...prev, defaultTerms: e.target.value }))}
                placeholder="ระบุข้อกำหนด กฎระเบียบ และเงื่อนไขของหอพัก..."
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs font-mono leading-relaxed"
              />
            </div>

            {/* 3. Owner Digital Signature */}
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-bold text-slate-800 flex items-center gap-2">
                    <PenTool className="w-5 h-5 text-indigo-600" />
                    ลายเซ็นดิจิทัลของเจ้าของหอพัก <span className="text-rose-500">*</span>
                  </label>
                  <p className="text-xs text-slate-500 mt-0.5">ใช้วาดสำหรับประทับลงในสัญญาเช่าและใบเสร็จรับเงินอย่างเป็นทางการ</p>
                </div>
                {(signatureSaved || savedSignatureDataUrl) && (
                  <span data-testid="signature-status-saved" className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    บันทึกแล้ว
                  </span>
                )}
              </div>

              {/* Persistent Signature Preview when saved and not editing */}
              {(signatureSaved || savedSignatureDataUrl) && !isEditingSignature ? (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-inner flex items-center justify-center max-w-[280px]">
                    {savedSignatureDataUrl || (provisionalDormitoryId && signatureSaved) ? (
                      <img
                        src={savedSignatureDataUrl || `/api/v1/dormitories/${provisionalDormitoryId}/signatures?t=${Date.now()}`}
                        alt="Owner Signature"
                        className="h-16 object-contain"
                      />
                    ) : (
                      <span className="text-xs font-bold text-slate-400">ยังไม่มีลายเซ็นในระบบ</span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingSignature(true);
                      hasDrawnRef.current = false;
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                  >
                    วาดใหม่ (Redraw)
                  </button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-300 rounded-2xl p-2 bg-slate-50 flex flex-col items-center">
                  <canvas
                    data-testid="canvas-signature"
                    ref={canvasRef}
                    width={560}
                    height={180}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="bg-white rounded-xl shadow-inner border border-slate-200 cursor-crosshair touch-none max-w-full"
                  />
                  <div className="flex items-center justify-between w-full max-w-[560px] mt-3 px-1">
                    <button
                      type="button"
                      onClick={clearCanvas}
                      className="text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
                    >
                      ล้างลายเซ็น
                    </button>
                    <button
                      type="button"
                      data-testid="button-save-signature"
                      onClick={handleSaveSignature}
                      disabled={signatureUploading}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {signatureUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      บันทึกลายเซ็น
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 6: Connect LINE OA */}
        {currentStep === 6 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <MessageSquare className="w-6 h-6 text-[#06C755]" />
                  ขั้นตอนที่ 6: เชื่อมต่อ LINE Official Account (LINE OA)
                </h2>
                <p className="text-slate-500 text-sm mt-1">
                  กรอก Channel ID และ Channel Secret เพื่อเปิดใช้งานระบบแจ้งเตือนอัตโนมัติ (ข้ามขั้นตอนนี้ได้หากยังไม่มี)
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowLineHelpModal(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <HelpCircle className="w-4 h-4 text-indigo-600" />
                ดูวิธีตั้งค่า
              </button>
            </div>

            {/* Always Visible 5-State Status Card */}
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500">สถานะการเชื่อมต่อ:</span>
                <span className={`px-3 py-1 rounded-full text-xs font-black border ${
                  lineStatus.isReady
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : lineStatus.credentialsVerified
                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                    : lineChannelId
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : 'bg-slate-100 text-slate-600 border-slate-300'
                }`}>
                  {lineStatus.isReady
                    ? 'พร้อมใช้งาน (READY) ✅'
                    : lineStatus.credentialsVerified
                    ? 'ยืนยัน Credentials สำเร็จ (VERIFIED) 🔹'
                    : lineChannelId
                    ? 'รอดำเนินการ ⏳'
                    : 'ยังไม่ได้ตั้งค่า (NOT CONFIGURED)'}
                </span>
              </div>

              {lineOaId && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs flex items-center justify-between">
                  <span className="font-bold text-slate-700">LINE Basic ID:</span>
                  <span className="font-mono font-bold text-emerald-800">{lineOaId}</span>
                </div>
              )}
            </div>

            {/* Credentials Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/50 p-6 rounded-2xl border border-slate-200">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">LINE Channel ID</label>
                <input
                  type="text"
                  data-testid="input-line-channel-id"
                  value={lineChannelId}
                  onChange={e => setLineChannelId(e.target.value)}
                  placeholder="1657XXXXXX"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono text-sm font-semibold bg-white"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">Channel Secret</label>
                <input
                  type="password"
                  data-testid="input-line-channel-secret"
                  value={lineChannelSecret}
                  onChange={e => setLineChannelSecret(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono text-sm font-semibold bg-white"
                />
              </div>

              <div className="md:col-span-2 flex justify-end">
                <button
                  type="button"
                  data-testid="button-save-line-credentials"
                  onClick={handleVerifyLineCredentials}
                  disabled={lineVerifying}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {lineVerifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  ตรวจสอบและเชื่อมต่อ LINE OA
                </button>
              </div>
            </div>

            {/* Webhook URL Box */}
            {webhookUrl && (
              <div className="space-y-3 p-5 bg-slate-900 text-white rounded-2xl border border-slate-800">
                <label className="block text-xs font-bold text-slate-300">Webhook URL สำหรับนำไปใส่ใน LINE Developers Console</label>
                <div className="font-mono text-xs text-emerald-400 bg-slate-950 p-3 rounded-xl break-all border border-slate-800">
                  {webhookUrl}
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(webhookUrl)}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  {copiedWebhook ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  {copiedWebhook ? 'คัดลอก Webhook URL เรียบร้อย!' : 'คัดลอก Webhook URL'}
                </button>
              </div>
            )}

            {/* Skip Button Option */}
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setCurrentStep(7)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                ข้ามขั้นตอนนี้ไปก่อน (สามารถตั้งค่าภายหลังได้ในหน้าตั้งค่า) →
              </button>
            </div>
          </div>
        )}

        {/* STEP 7: Package Selection & Finalization */}
        {currentStep === 7 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 7: เลือกแพ็กเกจและยืนยันการเปิดใช้งาน
              </h2>
              <p className="text-slate-500 text-sm mt-1">เลือกแพ็กเกจที่เหมาะสมสำหรับหอพักของคุณ (เริ่มต้นใช้งานฟรีถาวร)</p>
            </div>

            {/* Plan Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* FREE Plan Card (Default) */}
              <div
                onClick={() => {
                  setSelectedPlanCode('FREE');
                  setSelectedPackageId(null);
                }}
                className={`p-6 rounded-3xl border-2 cursor-pointer transition-all space-y-4 ${
                  selectedPlanCode === 'FREE'
                    ? 'border-indigo-600 bg-indigo-50/40 shadow-sm ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-black">
                    FREE 1 เดือน — ต่ออายุสิทธิ์อัตโนมัติ
                  </span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedPlanCode === 'FREE' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
                  }`}>
                    {selectedPlanCode === 'FREE' && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-black text-slate-900">HorPlus FREE</h3>
                  <div className="text-2xl font-black text-indigo-600 mt-1">฿0 <span className="text-xs font-normal text-slate-500">/ เดือน (ต่ออายุสิทธิ์ FREE อัตโนมัติทุกเดือน)</span></div>
                </div>

                <div className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-200/60">
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>เปิดใช้งานได้พร้อมกัน <strong>10 ห้องพักแรก</strong> (ใช้งานต่อเนื่องไม่มีวันหมดอายุ)</span>
                  </div>
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>สร้างตึกและห้องพักได้ไม่จำกัดเพื่อวางผัง</span>
                  </div>
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>ระบบบันทึกบัญชี ออกบิล และใบเสร็จรับเงินอัตโนมัติ</span>
                  </div>
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>โควตา LINE แจ้งเตือน 30 ข้อความ/เดือน</span>
                  </div>
                </div>
              </div>

              {/* PAID Plan Card */}
              <div
                onClick={() => {
                  setSelectedPlanCode('PAID');
                  const proPkg = catalogPackages.find(p => p.planCode === 'PAID' || p.code === 'PRO');
                  if (proPkg) setSelectedPackageId(proPkg.id);
                }}
                className={`p-6 rounded-3xl border-2 cursor-pointer transition-all space-y-4 ${
                  selectedPlanCode === 'PAID'
                    ? 'border-indigo-600 bg-indigo-50/40 shadow-sm ring-2 ring-indigo-500/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 bg-indigo-600 text-white rounded-full text-xs font-black">
                    PRO
                  </span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedPlanCode === 'PAID' ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
                  }`}>
                    {selectedPlanCode === 'PAID' && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-black text-slate-900">HorPlus PRO</h3>
                  <div className="text-2xl font-black text-indigo-600 mt-1">฿189 <span className="text-xs font-normal text-slate-500">/ เดือน</span></div>
                </div>

                <div className="space-y-2 text-xs text-slate-600 pt-2 border-t border-slate-200/60">
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>รองรับสูงสุด <strong>150 ห้องพัก</strong></span>
                  </div>
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>โควตา LINE แจ้งเตือน 300 ข้อความ/เดือน</span>
                  </div>
                  <div className="flex items-center gap-2 font-semibold">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>ฟังก์ชันระบบบริหารจัดการครบวงจร</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Promo Code Input */}
            <div className="p-5 bg-gradient-to-br from-indigo-50 via-blue-50 to-indigo-100/60 border border-indigo-200 rounded-2xl space-y-3">
              <label className="block text-xs font-bold text-slate-700">
                มีรหัสโปรโมชันใช่ไหม? (กรอก "HORPLUS" เพื่อรับสิทธิ์ทดลองใช้งานฟรีเพิ่ม 60 วัน)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  data-testid="input-promo-code"
                  value={promoCodeInput}
                  onChange={e => setPromoCodeInput(e.target.value.toUpperCase())}
                  placeholder="HORPLUS"
                  className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold tracking-wider uppercase bg-white w-64"
                />
                <button
                  type="button"
                  data-testid="button-apply-promo"
                  onClick={handleApplyPromoCode}
                  disabled={promoApplying}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50 cursor-pointer"
                >
                  {promoApplying ? 'กำลังตรวจสอบ...' : 'ใช้รหัส'}
                </button>
              </div>
              {promoSuccess && <div className="text-xs font-bold text-emerald-700 mt-1">{promoSuccess}</div>}
              {promoError && <div className="text-xs font-bold text-rose-600 mt-1">{promoError}</div>}
            </div>
          </div>
        )}

        {/* Footer Navigation Controls */}
        <div className="mt-8 flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80">
          <button
            type="button"
            onClick={handlePrevStep}
            disabled={currentStep === 1}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            ย้อนกลับ
          </button>

          {currentStep < 7 ? (
            <button
              type="button"
              data-testid="button-next-step"
              onClick={handleNextStep}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all cursor-pointer"
            >
              ถัดไป
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="button-finalize-onboarding"
              onClick={handleOpenTermsModal}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-8 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold text-sm shadow-lg shadow-indigo-200 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              ยืนยันสร้างหอพัก
            </button>
          )}
        </div>
      </div>

      {/* LINE OA Help Modal */}
      {showLineHelpModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-indigo-600" />
                วิธีตั้งค่า LINE Official Account
              </h3>
              <button onClick={() => setShowLineHelpModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-100 font-medium">
                1. เข้าสู่ <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline inline-flex items-center gap-1">LINE Developers Console <ExternalLink className="w-3 h-3" /></a> แล้วเลือกหรือสร้าง Provider
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                2. สร้าง Channel ประเภท <strong>Messaging API</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                3. ในแท็บ <strong>Basic settings</strong> ให้คัดลอก <strong>Channel ID</strong> และ <strong>Channel Secret</strong> มาวางในช่องด้านบน
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                4. ในแท็บ <strong>Messaging API</strong> นำ <strong>Webhook URL</strong> จากระบบ HorPlus ไปวาง และเปิดใช้งาน <strong>Use Webhook</strong>
              </div>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100">
                5. ใน LINE Official Account Manager ให้ปิดฟังก์ชัน <strong>Auto-reply messages</strong>
              </div>
            </div>

            <button
              onClick={() => setShowLineHelpModal(false)}
              className="w-full py-2.5 bg-indigo-600 text-white font-extrabold text-xs rounded-xl hover:bg-indigo-700 transition-colors"
            >
              เข้าใจแล้ว ปิดหน้าต่าง
            </button>
          </div>
        </div>
      )}

      {/* Terms & Conditions Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl space-y-6 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                เงื่อนไขและช่องทางที่รู้จัก HorPlus
              </h3>
              <button onClick={() => setShowTermsModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">คุณรู้จัก HorPlus จากช่องทางใด? <span className="text-rose-500">*</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {REFERRAL_OPTIONS.map(rf => (
                    <button
                      key={rf.id}
                      type="button"
                      onClick={() => setReferralSource(rf.id)}
                      className={`p-3 rounded-xl border text-left flex items-center gap-2 text-xs font-bold transition-all ${
                        referralSource === rf.id
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <rf.icon className="w-4 h-4 shrink-0 text-indigo-600" />
                      <span>{rf.label}</span>
                    </button>
                  ))}
                </div>
                {referralSource === 'other' && (
                  <input
                    type="text"
                    value={referralOtherText}
                    onChange={e => setReferralOtherText(e.target.value)}
                    placeholder="ระบุช่องทางที่รู้จัก HorPlus"
                    className="w-full mt-2 px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                  />
                )}
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-2">
                <div className="font-bold text-slate-800">ข้อตกลงการใช้งานระบบ:</div>
                <p>1. ข้อมูลทั้งหมดจะถูกจัดเก็บอย่างปลอดภัยด้วยมาตรฐานระบบความปลอดภัยของ HorPlus</p>
                <p>2. ลายเซ็นดิจิทัลจะใช้ประทับลงบนเอกสารสัญญาและใบเสร็จรับเงินอย่างเป็นทางการเท่านั้น</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  data-testid="checkbox-agreed-terms"
                  checked={agreedTerms}
                  onChange={e => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-indigo-600 rounded-md border-slate-300 focus:ring-indigo-500"
                />
                <span className="text-xs font-semibold text-slate-700 leading-snug">
                  ข้าพเจ้ายินยอมรับข้อตกลง เงื่อนไขการใช้งาน และนโยบายความเป็นส่วนตัวของ HorPlus
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                data-testid="button-confirm-finalize"
                onClick={handleFinalize}
                disabled={isSubmitting || !agreedTerms || !referralSource}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50"
              >
                {isSubmitting ? 'กำลังลงทะเบียน...' : 'ยืนยันลงทะเบียน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Room Editing Modal */}
      {editingRoom && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">แก้ไขหมายเลขห้อง</h3>
            <input
              type="text"
              value={editingRoom.newRoom}
              onChange={e => setEditingRoom({ ...editingRoom, newRoom: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 text-sm"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setEditingRoom(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">ยกเลิก</button>
              <button onClick={handleSaveSingleRoomEdit} className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold">บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Room Editing Modal */}
      {bulkEditingBuildingIdx !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-800">แก้ไขหมายเลขห้องทั้งหมดแบบชุด (คั่นด้วยจุลภาคหรือเว้นวรรค)</h3>
            <textarea
              rows={5}
              value={bulkRoomsInputText}
              onChange={e => setBulkRoomsInputText(e.target.value)}
              placeholder="เช่น A101, A102, A103, A201, A202"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs font-semibold"
            />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setBulkEditingBuildingIdx(null)} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600">ยกเลิก</button>
              <button onClick={() => handleSaveBulkEdit(bulkEditingBuildingIdx)} className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">บันทึกชุดห้อง</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OwnerRegister;
