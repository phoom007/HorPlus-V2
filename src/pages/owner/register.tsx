import React, { useState, useRef, useEffect, Component } from 'react';
import { 
  Building2, 
  User, 
  Phone, 
  Mail, 
  MapPin, 
  CreditCard, 
  ShieldCheck, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  Trash2, 
  Zap, 
  Droplet, 
  Wifi, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft, 
  Save, 
  Check, 
  X, 
  Building as BuildingIcon,
  MessageSquare,
  PenTool,
  Upload,
  RefreshCw,
  Info,
  CheckCircle,
  Clock,
  HelpCircle,
  Users,
  Copy,
  ExternalLink,
  Edit3,
  SlidersHorizontal
} from 'lucide-react';
import { onboardingClient, CompleteOnboardingPayload } from '../../data/onboardingClient';

interface RegisterProps {
  onAddLog?: (action: string, details: string, module: string, targetId?: string) => void;
  onNavigate?: (tab: string) => void;
}

const BANK_OPTIONS = [
  'กรุงไทย (Krungthai)',
  'กสิกรไทย (KBank)',
  'กรุงเทพ (Bangkok)',
  'ไทยพาณิชย์ (SCB)',
  'กรุงศรีอยุธยา (Krungsri)',
  'ทหารไทยธนชาต (ttb)',
  'ยูโอบี (UOB)',
  'ซีไอเอ็มบี ไทย (CIMB Thai)',
  'แลนด์ แอนด์ เฮ้าส์ (LH Bank)',
  'เกียรตินาคินภัทร (KKP)',
  'ทิสโก้ (TISCO)',
  'ไอซีบีซี (ICBC Thai)',
  'ออมสิน (GSB)',
  'ธ.ก.ส. (BAAC)',
  'ธอส. (GH Bank)',
  'อิสลามแห่งประเทศไทย (IBANK)'
];

const PROVINCE_OPTIONS = [
  'กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา',
  'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก',
  'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน',
  'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา',
  'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม',
  'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี',
  'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม',
  'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์',
  'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี'
];

const DORM_TYPE_OPTIONS = [
  'หอพักนักเรียน/นักศึกษา',
  'อพาร์ตเมนต์',
  'คอนโดมิเนียม',
  'โรงแรม',
  'บ้านเช่า',
  'Co-Living',
  'อื่นๆ'
];

const GENDER_TYPE_OPTIONS = [
  { id: 'รวม', label: 'หอพักรวม', desc: 'เปิดรับทุกเพศ' },
  { id: 'ชาย', label: 'หอพักชาย', desc: 'ผู้พักชายเท่านั้น' },
  { id: 'หญิง', label: 'หอพักหญิง', desc: 'ผู้พักหญิงเท่านั้น' }
];

const REFERRAL_OPTIONS = [
  { id: 'facebook', label: 'Facebook / Social Media', icon: MessageSquare },
  { id: 'google', label: 'Google Search', icon: HelpCircle },
  { id: 'friend', label: 'เพื่อน / คนรู้จักแนะนำ', icon: Users },
  { id: 'other', label: 'อื่นๆ', icon: Sparkles }
];

// Formatting helpers
const formatPhone = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const formatIdCard = (val: string) => {
  const digits = val.replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 1) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 1)}-${digits.slice(1)}`;
  if (digits.length <= 10) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10)}`;
  return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
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

      return {
        id: (bObj.id ?? `b-${idx + 1}`).toString(),
        name: (bObj.name ?? `อาคาร ${String.fromCharCode(65 + idx)}`).toString(),
        totalFloors: Math.max(1, totalFloors),
        roomsPerFloor: Math.max(0, roomsPerFloor),
        hasElevator: Boolean(bObj.hasElevator ?? false),
        roomPrefix: (bObj.roomPrefix ?? '').toString(),
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
    waterRate: parseNum(rawUtil.waterRate, neutralInitialState.utilities?.waterRate ?? 0),
    electricBillingMode: (rawUtil.electricBillingMode ?? neutralInitialState.utilities?.electricBillingMode ?? 'unit').toString(),
    electricRate: parseNum(rawUtil.electricRate, neutralInitialState.utilities?.electricRate ?? 0),
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
    bankName: (rawPayAcc.bankName ?? rawPayAcc.bankCode ?? neutralInitialState.paymentAccount?.bankName ?? '').toString(),
    accountNumber: (rawPayAcc.accountNumber ?? rawPayAcc.bankAccountNumber ?? neutralInitialState.paymentAccount?.accountNumber ?? '').toString(),
    accountName: (rawPayAcc.accountName ?? rawPayAcc.bankAccountName ?? neutralInitialState.paymentAccount?.accountName ?? '').toString(),
    bankAccountName: (rawPayAcc.bankAccountName ?? rawPayAcc.accountName ?? neutralInitialState.paymentAccount?.bankAccountName ?? '').toString(),
    promptPayId: (rawPayAcc.promptPayId ?? rawPayAcc.promptPayValue ?? neutralInitialState.paymentAccount?.promptPayId ?? '').toString(),
  };

  return result;
}

class OnboardingErrorBoundary extends Component<any, any> {
  public state = { hasError: false };
  public props: any;
  public setState: any;

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
            <h2 className="text-lg font-bold text-slate-800">
              ไม่สามารถแสดงข้อมูลขั้นตอนนี้ได้
            </h2>
            <p className="text-slate-500 text-sm">
              เกิดข้อผิดพลาดในการแสดงผล กรุณาลองรีเฟรชหน้าเว็บ หรือกดปุ่มย้อนกลับเพื่อลองใหม่อีกครั้ง
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (typeof (this as any).setState === 'function') {
                    (this as any).setState({ hasError: false });
                  }
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-all"
              >
                รีเฟรชหน้าเว็บ
              </button>
            </div>
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

const OwnerRegisterInner: React.FC<RegisterProps> = ({ onAddLog, onNavigate }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Terms & Referral Modal states
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [referralSource, setReferralSource] = useState('facebook');
  const [referralOtherText, setReferralOtherText] = useState('');

  // Room editing states
  const [manualInputs, setManualInputs] = useState<{ [bId: string]: string }>({});
  const [editingRoom, setEditingRoom] = useState<{ bIdx: number; oldRoom: string; newRoom: string } | null>(null);
  const [bulkEditingBuildingIdx, setBulkEditingBuildingIdx] = useState<number | null>(null);
  const [bulkRoomsInputText, setBulkRoomsInputText] = useState<string>('');

  // Provisional State
  const [provisionalDormitoryId, setProvisionalDormitoryId] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  // Step 4: Signature States
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const hasDrawnRef = useRef(false);
  const [signatureSaved, setSignatureSaved] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);

  // Step 5: LINE OA States
  const [lineChannelId, setLineChannelId] = useState('');
  const [lineChannelSecret, setLineChannelSecret] = useState('');
  const [lineOaId, setLineOaId] = useState('');
  const [lineVerifying, setLineVerifying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
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

  // Step 6: Package & Catalog States
  const [catalogPackages, setCatalogPackages] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoSuccess, setPromoSuccess] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromoResult, setAppliedPromoResult] = useState<any>(null);

  // 1-4 Full Form Data State
  const [formData, setFormData] = useState({
    // Step 1: Dorm Info
    dormitoryName: '',
    address: '',
    province: '',
    dormType: 'อพาร์ตเมนต์',
    genderType: 'รวม',

    // Step 2: Flexible Structure
    buildings: [
      {
        id: 'b-1',
        name: 'อาคาร 1',
        totalFloors: 1,
        roomsPerFloor: 0,
        hasElevator: false,
        roomPrefix: '',
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
      waterRate: 0,
      electricBillingMode: 'unit',
      electricRate: 0,
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
      bankName: '',
      accountNumber: '',
      accountName: '',
      bankAccountName: '',
      promptPayId: ''
    }
  });

  // Room generation helper supporting all 5 patterns
  const getGeneratedRooms = (b: {
    totalFloors: number;
    roomsPerFloor: number;
    roomPrefix: string;
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
    const prefix = b.roomPrefix ? b.roomPrefix.trim() : '';

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
            roomNum = `${prefix ? prefix + '-' : ''}${floor}${rmStr}`;
            break;
          default:
            roomNum = `${prefix}${floor}${rmStr}`;
        }
        rooms.push(roomNum);
      }
    }
    return rooms;
  };

  // Building handlers
  const handleAddBuilding = () => {
    const nextChar = String.fromCharCode(65 + formData.buildings.length);
    const newBuilding = {
      id: `b-${Date.now()}`,
      name: `อาคาร ${nextChar}`,
      totalFloors: 1,
      roomsPerFloor: 0,
      hasElevator: false,
      roomPrefix: '',
      formatPattern: 'prefix_floor_room',
      mode: 'auto' as 'auto' | 'manual',
      customRooms: [] as string[],
      securityDeposit: 0,
      rentRates: {
        monthly: 0,
        term: 0,
        termMonths: 6,
        daily: 0,
        maxOccupants: 2
      }
    };
    setFormData(prev => ({ ...prev, buildings: [newBuilding, ...prev.buildings] }));
  };

  const handleRemoveBuilding = (id: string) => {
    if (formData.buildings.length <= 1) return;
    setFormData(prev => ({ ...prev, buildings: prev.buildings.filter(b => b.id !== id) }));
  };

  const handleRemoveSingleRoom = (bIdx: number, roomNum: string) => {
    const updated = [...formData.buildings];
    const b = updated[bIdx];
    const currentList = getGeneratedRooms(b);
    const filtered = currentList.filter(r => r !== roomNum);
    b.customRooms = filtered.length === 0 ? ['__EMPTY__'] : filtered;
    setFormData({ ...formData, buildings: updated });
  };

  const handleAddManualRooms = (bIdx: number) => {
    const b = formData.buildings[bIdx];
    const text = manualInputs[b.id] || '';
    if (!text.trim()) return;

    const parsed = text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (parsed.length === 0) return;

    const updated = [...formData.buildings];
    const existing = b.customRooms && b.customRooms.length > 0 ? b.customRooms.filter(r => r !== '__EMPTY__') : getGeneratedRooms(b);
    const combined = Array.from(new Set([...existing, ...parsed]));
    updated[bIdx].customRooms = combined;
    setFormData({ ...formData, buildings: updated });
    setManualInputs(prev => ({ ...prev, [b.id]: '' }));
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
    setFormData({ ...formData, buildings: updated });
    setBulkEditingBuildingIdx(null);
  };

  const handleSaveBulkEdit = (bIdx: number) => {
    const text = bulkRoomsInputText || '';
    const parsed = text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const updated = [...formData.buildings];
    updated[bIdx].customRooms = parsed.length === 0 ? ['__EMPTY__'] : parsed;
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
        const proPkg = pkgs.find((p: any) => p.planCode === 'PAID' || p.plan?.code === 'PAID' || p.code === 'PRO' || p.planCode === 'PRO');
        if (proPkg) {
          setSelectedPackageId(proPkg.id);
        }
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
            setSignatureSaved(Boolean(draft.signatureSaved || draft.payload?.signatureSaved));
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

  const proPkg = catalogPackages.find((p: any) => p.planCode === 'PAID' || p.plan?.code === 'PAID' || p.code === 'PRO' || p.planCode === 'PRO');

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
  };

  // Prepare setup_pending dormitory before Step 4 signature upload
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

  // Upload Signature
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
      onAddLog?.('UPLOAD_SIGNATURE', `บันทึกลายเซ็นเจ้าของหอพักสำหรับ provisionalDormitoryId: ${dormId}`, 'ONBOARDING');
    } catch (err: any) {
      setValidationError(err.message || 'การบันทึกลายเซ็นล้มเหลว กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSignatureUploading(false);
    }
  };

  // Step 5: Verify Credentials
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

  // Step 5: Set Webhook Endpoint
  const handleSetLineWebhook = async () => {
    if (!provisionalDormitoryId) return;
    setLineVerifying(true);
    setValidationError(null);
    try {
      const res = await onboardingClient.setLineWebhook(provisionalDormitoryId);
      const raw = res.data || res;
      const config = raw.config || raw;
      const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
      const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
      const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      setLineStatus(prev => ({
        ...prev,
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        isReady,
      }));
    } catch (err: any) {
      setValidationError(err.message || 'ไม่สามารถตั้งค่า Webhook Endpoint บน LINE Platform ได้');
    } finally {
      setLineVerifying(false);
    }
  };

  // Step 5: Test Webhook Endpoint
  const handleTestLineWebhook = async () => {
    if (!provisionalDormitoryId) return;
    setLineVerifying(true);
    setValidationError(null);
    try {
      const res = await onboardingClient.testLineWebhook(provisionalDormitoryId);
      const raw = res.data || res;
      const config = raw.config || raw;
      const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
      const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
      const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
      const webhookActive = Boolean(config.webhookActive);
      const isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;

      setLineStatus(prev => ({
        ...prev,
        credentialsVerified,
        webhookEndpointSet,
        webhookTestSucceeded,
        webhookActive,
        isReady,
      }));
    } catch (err: any) {
      setValidationError(err.message || 'การทดสอบ Webhook Endpoint ล้มเหลว');
    } finally {
      setLineVerifying(false);
    }
  };

  // Step 6: Validate Promo Code
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
        setPromoSuccess(`ใช้รหัสโปรโมชัน "${raw.code}" สำเร็จ! รับสิทธิ์ทดลองใช้งานฟรีเพิ่ม ${raw.promoBonusMonths || 2} เดือน (รวมเป็น ${raw.totalTrialMonths || 3} เดือน)`);
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
        return { valid: false, error: 'กรุณาเลือก "ประเภทผู้พัก / เพศของหอพัก"' };
      }
    }

    if (stepNum === 2) {
      if (!formData.buildings || formData.buildings.length === 0) {
        return { valid: false, error: 'กรุณาเพิ่มอาคารอย่างน้อย 1 อาคาร' };
      }
      for (let i = 0; i < formData.buildings.length; i++) {
        const b = formData.buildings[i];
        const bLabel = b.roomPrefix ? `อาคาร ${b.roomPrefix}` : (b.name || `อาคารที่ ${i + 1}`);

        if (b.mode === 'auto') {
          if (!b.totalFloors || b.totalFloors <= 0) {
            return { valid: false, error: `กรุณากรอก "จำนวนชั้น" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
          }
          if (!b.roomsPerFloor || b.roomsPerFloor <= 0) {
            return { valid: false, error: `กรุณากรอก "ห้องต่อชั้น" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
          }
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
      if (!signatureSaved) {
        return { valid: false, error: 'กรุณากด "บันทึกลายเซ็น" ในขั้นตอนที่ 4 ก่อนดำเนินการต่อ' };
      }
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

      if (formData.paymentAccount.promptPayId && formData.paymentAccount.promptPayId.trim()) {
        const cleanPP = formData.paymentAccount.promptPayId.replace(/\D/g, '');
        if (cleanPP.length !== 10 && cleanPP.length !== 13) {
          return { valid: false, error: 'กรุณากรอก "เลขพร้อมเพย์" ให้ถูกต้อง (เบอร์โทร 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก)' };
        }
      }
    }

    if (stepNum === 5) {
      if (!lineStatus.isReady) {
        return { valid: false, error: 'กรุณาตั้งค่า LINE OA ให้ครบทุกขั้นตอนก่อนดำเนินการต่อ' };
      }
    }

    return { valid: true };
  };

  // Step Navigation Validation
  const handleNextStep = async () => {
    const check = validateStep(currentStep);
    if (!check.valid) {
      setValidationError(check.error || 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setValidationError(null);

    let nextStepNum = currentStep + 1;
    if (currentStep === 3) {
      await ensureProvisionalDormitory();
      nextStepNum = 4;
      setCurrentStep(4);
    } else if (currentStep === 4) {
      await ensureProvisionalDormitory();
      nextStepNum = 5;
      setCurrentStep(5);
    } else if (currentStep === 5) {
      const dormId = provisionalDormitoryId || await ensureProvisionalDormitory();
      let isReady = lineStatus.isReady;
      if (!isReady && dormId) {
        try {
          const lineRes = await onboardingClient.getLineConfig(dormId);
          const raw = lineRes.data || lineRes;
          const config = raw.config || raw;
          const credentialsVerified = Boolean(config.credentialsVerified || config.accessTokenVerifiedAt);
          const webhookEndpointSet = Boolean(config.webhookEndpointSet || config.webhookEndpointSetAt);
          const webhookTestSucceeded = Boolean(config.webhookTestSucceeded || config.webhookTestSucceededAt);
          const webhookActive = Boolean(config.webhookActive);
          isReady = credentialsVerified && webhookEndpointSet && webhookTestSucceeded && webhookActive;
          if (isReady) {
            setLineStatus(prev => ({
              ...prev,
              credentialsVerified,
              webhookEndpointSet,
              webhookTestSucceeded,
              webhookActive,
              isReady: true,
            }));
          }
        } catch {}
      }

      if (!isReady) {
        setValidationError('กรุณาตั้งค่า LINE OA ให้ครบทุกขั้นตอนก่อนดำเนินการต่อ');
        return;
      }
      nextStepNum = 6;
      setCurrentStep(6);
    } else {
      setCurrentStep(nextStepNum);
    }

    onboardingClient.saveDraft(String(nextStepNum), {
      ...formData,
      signatureSaved: signatureSaved || hasDrawnRef.current,
      dormitoryName: formData.dormitoryName,
      address: formData.address,
      province: formData.province,
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
      // Prepare buildings & rooms payloads
      const buildingsPayload: any[] = [];
      const roomsPayload: any[] = [];

      formData.buildings.forEach((b, bIdx) => {
        const bId = b.id || `bld-${bIdx + 1}`;
        buildingsPayload.push({
          id: bId,
          name: b.name || `อาคาร ${bIdx + 1}`,
          floorsCount: b.totalFloors || 1,
          roomsPerFloor: b.roomsPerFloor || 0,
          roomPrefix: b.roomPrefix || null,
          hasElevator: Boolean(b.hasElevator),
          numberingPattern: b.formatPattern || (b as any).numberingPattern || 'prefix_floor_room',
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
          dueDay: (formData.deposits.dueDateDay !== undefined && formData.deposits.dueDateDay !== null && formData.deposits.dueDateDay !== '') ? Number(formData.deposits.dueDateDay) : 5,
          waterBillingType: 'per_unit',
          waterRate: String(formData.utilities.waterRate ?? 0),
          electricityBillingType: 'per_unit',
          electricityRate: String(formData.utilities.electricRate ?? 0),
          commonFee: String(formData.utilities.commonFeeRate ?? 0),
          commonFeeMode: formData.utilities.commonFeeMode || 'none',
          internetFee: String(formData.utilities.internetRate ?? 0),
          internetFeeMode: formData.utilities.internetFeeMode || 'none',
          parkingRate: String(formData.utilities.parkingFeeRate ?? 0),
          parkingFeeMode: formData.utilities.parkingFeeMode || 'none',
          gracePeriodDays: (formData.deposits.gracePeriodDays !== undefined && formData.deposits.gracePeriodDays !== null && formData.deposits.gracePeriodDays !== '') ? Number(formData.deposits.gracePeriodDays) : 0,
          advanceRentMonths: (formData.deposits.advanceRentMonths !== undefined && formData.deposits.advanceRentMonths !== null && formData.deposits.advanceRentMonths !== '') ? Number(formData.deposits.advanceRentMonths) : 1,
          lateFeeType: (formData.deposits.lateFeeType as any) || 'none',
          lateFeeValue: String(formData.deposits.lateFeeAmount ?? 0),
          rentBillingType: 'monthly',
        },
        payment: {
          cashAccepted: true,
          promptPayType,
          promptPayValue,
          bankCode: formData.paymentAccount.bankName || undefined,
          bankAccountName: (formData.paymentAccount.bankAccountName || formData.paymentAccount.accountName || '').trim() || undefined,
          bankAccountNumber: formData.paymentAccount.accountNumber.trim() || undefined,
        },
        buildings: buildingsPayload,
        rooms: roomsPayload,
        planCode: 'PAID',
        packageId: selectedPackageId || undefined,
        promoCode: appliedPromoResult ? appliedPromoResult.code : (promoCodeInput.trim() || undefined),
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-16 font-sans">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white py-8 px-4 shadow-md mb-8">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-xl backdrop-blur-sm border border-white/20">
              <Building2 className="w-8 h-8 text-blue-200" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">ระบบลงทะเบียนหอพัก HorPlus</h1>
              <p className="text-blue-200 text-sm mt-0.5">กรอกข้อมูล 6 ขั้นตอนเพื่อเริ่มต้นใช้งานระบบบริหารจัดการหอพักมืออาชีพ</p>
            </div>
          </div>
          <div className="hidden md:block text-right">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-500/30 text-blue-100 border border-blue-400/30">
              ขั้นตอนที่ {currentStep} จาก 6
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4">
        {/* Step Indicator */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/80 mb-8 overflow-x-auto">
          <div className="flex items-center justify-between min-w-[640px]">
            {[
              { num: 1, name: 'ข้อมูลทั่วไป', icon: Building2 },
              { num: 2, name: 'โครงสร้างอาคาร', icon: BuildingIcon },
              { num: 3, name: 'ค่าเช่าและยูนิต', icon: Zap },
              { num: 4, name: 'การชำระและลายเซ็น', icon: CreditCard },
              { num: 5, name: 'เชื่อมต่อ LINE OA', icon: MessageSquare },
              { num: 6, name: 'เลือกแพ็กเกจ', icon: Sparkles }
            ].map((st, idx) => {
              const Icon = st.icon;
              const isActive = currentStep === st.num;
              const isDone = currentStep > st.num;
              return (
                <React.Fragment key={st.num}>
                  {idx > 0 && (
                    <div className={`flex-1 h-0.5 mx-2 ${isDone ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                  )}
                  <button
                    onClick={() => {
                      if (st.num < currentStep) {
                        setCurrentStep(st.num);
                        setValidationError(null);
                      }
                    }}
                    disabled={st.num > currentStep}
                    className={`flex flex-col items-center gap-1.5 px-2 py-1 rounded-xl transition-all ${
                      isActive 
                        ? 'text-indigo-600 font-semibold' 
                        : isDone 
                        ? 'text-slate-700 cursor-pointer hover:text-indigo-600' 
                        : 'text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                      isActive 
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 scale-105' 
                        : isDone 
                        ? 'bg-indigo-100 text-indigo-700' 
                        : 'bg-slate-100 text-slate-400'
                    }`}>
                      {isDone ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span className="text-xs tracking-tight whitespace-nowrap">{st.name}</span>
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

        {/* STEP 1: Dormitory Info */}
        {currentStep === 1 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Building2 className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 1: ข้อมูลทั่วไปของหอพัก
              </h2>
              <p className="text-slate-500 text-sm mt-1">กรอกข้อมูลเบื้องต้นเกี่ยวกับหอพัก อพาร์ตเมนต์ หรือที่พักอาศัยของคุณ</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  ชื่อหอพัก / อพาร์ตเมนต์ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  data-testid="input-dormitory-name"
                  value={formData.dormitoryName}
                  onChange={e => setFormData(prev => ({ ...prev, dormitoryName: e.target.value }))}
                  placeholder="เช่น หอพัก สุขสบาย, อพาร์ทเม้นท์ รัชดา"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm font-medium transition-all"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="block text-sm font-semibold text-slate-700">
                  ที่อยู่หอพัก <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  data-testid="input-address"
                  value={formData.address}
                  onChange={e => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="เลขที่ ถนน ซอย ตำบล/แขวง อำเภอ/เขต"
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
                  ขั้นตอนที่ 2: โครงสร้างอาคารและห้องพัก
                </h2>
                <p className="text-slate-500 text-sm mt-1">กำหนดอาคาร จำนวนชั้น เลขห้อง และรูปแบบหมายเลขห้องพัก</p>
              </div>
              <button
                type="button"
                data-testid="button-add-building"
                onClick={handleAddBuilding}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-semibold text-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                เพิ่มอาคาร
              </button>
            </div>

            <div className="space-y-6">
              {formData.buildings.map((b, bIdx) => {
                const roomList = getGeneratedRooms(b);
                return (
                  <div key={b.id} className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-sm flex items-center justify-center">
                          {bIdx + 1}
                        </span>
                        <input
                          type="text"
                          value={b.name}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx].name = e.target.value;
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="font-bold text-slate-800 text-base bg-transparent border-b border-slate-300 focus:border-indigo-600 focus:outline-none px-1 py-0.5"
                        />
                      </div>
                      {formData.buildings.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBuilding(b.id)}
                          className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 text-xs font-semibold flex items-center gap-1"
                        >
                          <Trash2 className="w-4 h-4" />
                          ลบอาคาร
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-white p-4 rounded-xl border border-slate-200/80">
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">จำนวนชั้น</label>
                        <input
                          type="number"
                          data-testid="input-building-total-floors"
                          min={1}
                          max={100}
                          value={b.totalFloors}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx].totalFloors = Math.max(1, parseInt(e.target.value) || 1);
                            setFormData({ ...formData, buildings: updated });
                          }}
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
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx].roomsPerFloor = Math.max(0, parseInt(e.target.value) || 0);
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">นำหน้าห้อง (Prefix)</label>
                        <input
                          type="text"
                          data-testid="input-building-prefix"
                          value={b.roomPrefix}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx].roomPrefix = e.target.value;
                            setFormData({ ...formData, buildings: updated });
                          }}
                          placeholder="เช่น A, B"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1">รูปแบบเลขห้อง</label>
                        <select
                          data-testid="select-building-format-pattern"
                          value={b.formatPattern}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx].formatPattern = e.target.value;
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold bg-white"
                        >
                          <option value="prefix_floor_room">A101 (Prefix+Floor+Room)</option>
                          <option value="floor_room">101 (Floor+Room)</option>
                          <option value="prefix_floor_slash_room">A1/1 (Prefix+Floor/Room)</option>
                          <option value="floor_slash_room">1/1 (Floor/Room)</option>
                          <option value="prefix_dash_floor_room">A-101 (Prefix-Floor+Room)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="checkbox-building-has-elevator"
                          checked={Boolean(b.hasElevator)}
                          onChange={e => {
                            const updated = [...formData.buildings];
                            updated[bIdx].hasElevator = e.target.checked;
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                        />
                        มีลิฟต์ (Has Elevator)
                      </label>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                      <div className="text-xs font-semibold text-slate-600">
                        รายการห้องพัก ({roomList.length} ห้อง):
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenBulkEdit(bIdx)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          แก้ไขชุดห้อง
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetBuildingRooms(bIdx)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          รีเซ็ตสร้างอัตโนมัติ
                        </button>
                      </div>
                    </div>

                    {/* Room badges grid */}
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-3 bg-white rounded-xl border border-slate-200/80">
                      {roomList.map(rm => (
                        <div key={rm} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold">
                          <span>{rm}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveSingleRoom(bIdx, rm)}
                            className="text-indigo-400 hover:text-rose-600"
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
                ขั้นตอนที่ 3: ค่าเช่าและค่ายูนิตสาธารณูปโภค
              </h2>
              <p className="text-slate-500 text-sm mt-1">กำหนดอัตราค่าเช่า ค่าน้ำ ค่าไฟ และค่าบริการส่วนกลาง (รองรับอัตรา 0 บาทสำหรับโปรโมชัน)</p>
            </div>

            <div className="space-y-6">
              {/* Utilities Rates */}
              <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-4">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Droplet className="w-4 h-4 text-blue-600" />
                  อัตราค่าน้ำ ค่าไฟ และค่าบริการ
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    อัตราค่าเช่าสำหรับ {b.name}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">ค่าเช่ารายเดือน (บาท)</label>
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
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">จำนวนผู้พักสูงสุด (คน)</label>
                      <input
                        type="number"
                        data-testid="input-building-max-occupants"
                        min={1}
                        value={rentRates.maxOccupants ?? 2}
                        onChange={e => {
                          const updated = [...formData.buildings];
                          updated[bIdx] = {
                            ...updated[bIdx],
                            rentRates: { ...rentRates, maxOccupants: Math.max(1, Number(e.target.value)) }
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

        {/* STEP 4: Payment Account & Owner Signature Canvas */}
        {currentStep === 4 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <CreditCard className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 4: บัญชีรับชำระเงินและลายเซ็นเจ้าของหอพัก
              </h2>
              <p className="text-slate-500 text-sm mt-1">กรอกข้อมูลบัญชีรับเงินโอน ค่าประกัน และวาดลายเซ็นเจ้าของหอพักสำหรับใช้ในสัญญา</p>
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

              {/* Payment Account */}
              <div className="space-y-4 md:col-span-2">
                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-indigo-600" />
                  ข้อมูลบัญชีธนาคารสำหรับรับชำระค่าเช่า
                </h3>
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">เลขพร้อมเพย์ (Optional)</label>
                    <input
                      type="text"
                      data-testid="input-promptpay"
                      value={formData.paymentAccount.promptPayId}
                      onChange={e => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, promptPayId: e.target.value } }))}
                      placeholder="เบอร์โทรศัพท์ 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-semibold text-slate-800 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Owner Signature Canvas Section */}
              <div className="space-y-4 md:col-span-2 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm font-bold text-slate-800 flex items-center gap-2">
                      <PenTool className="w-5 h-5 text-indigo-600" />
                      ลายเซ็นเจ้าของหอพัก <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-xs text-slate-500 mt-0.5">ใช้วาดสำหรับประทับลงในสัญญาเช่าและใบเสร็จรับเงินอย่างเป็นทางการ</p>
                  </div>
                  {signatureSaved && (
                    <span data-testid="signature-status-saved" className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      บันทึกแล้ว
                    </span>
                  )}
                </div>

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
                      className="text-xs font-semibold text-slate-500 hover:text-rose-600 transition-colors"
                    >
                      ล้างลายเซ็น
                    </button>
                    <button
                      type="button"
                      data-testid="button-save-signature"
                      onClick={handleSaveSignature}
                      disabled={signatureUploading}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
                    >
                      {signatureUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      บันทึกลายเซ็น
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: LINE OA Configuration & Verified Identity Card */}
        {currentStep === 5 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-6 h-6 text-emerald-600" />
                ขั้นตอนที่ 5: การเชื่อมต่อและยืนยันตัวตน LINE Official Account
              </h2>
              <p className="text-slate-500 text-sm mt-1">กรอก Channel ID และ Channel Secret เพื่อเปิดใช้งานระบบแจ้งเตือนและส่งใบเสร็จผ่าน LINE OA</p>
            </div>

            {/* Verified LINE OA Profile Card */}
            {lineStatus.credentialsVerified && (
              <div className="p-6 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-emerald-500 bg-emerald-100 flex items-center justify-center shrink-0">
                      {lineStatus.botPictureUrl ? (
                        <img src={lineStatus.botPictureUrl} alt="LINE OA Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <MessageSquare className="w-8 h-8 text-emerald-600" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 text-lg">{lineStatus.botDisplayName || 'LINE Official Account'}</span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white shadow-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          เชื่อมต่อ Credentials สำเร็จ ✅
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-600 mt-1 space-x-3">
                        {lineOaId && <span>Basic ID: <strong className="text-emerald-700">{lineOaId}</strong></span>}
                        {lineStatus.botPremiumId && <span>Premium ID: <strong className="text-indigo-700">{lineStatus.botPremiumId}</strong></span>}
                        {lineChannelId && <span>Channel ID: <strong>{lineChannelId}</strong></span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Credentials Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/50 p-6 rounded-2xl border border-slate-200">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Channel ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  data-testid="input-line-channel-id"
                  value={lineChannelId}
                  onChange={e => setLineChannelId(e.target.value)}
                  placeholder="เช่น 2006123456"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono text-sm font-semibold bg-white"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Channel Secret <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  data-testid="input-line-channel-secret"
                  value={lineChannelSecret}
                  onChange={e => setLineChannelSecret(e.target.value)}
                  placeholder="••••••••••••••••••••••••••••••••"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono text-sm font-semibold bg-white"
                />
              </div>

              <div className="md:col-span-2 flex items-center justify-between">
                <span data-testid="line-readiness-badge" className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  lineStatus.isReady ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}>
                  {lineStatus.isReady ? 'พร้อมใช้งาน ✅' : 'รอดำเนินการ ⏳'}
                </span>

                <button
                  type="button"
                  data-testid="button-save-line-credentials"
                  onClick={handleVerifyLineCredentials}
                  disabled={lineVerifying}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-50"
                >
                  {lineVerifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  ตรวจสอบและเชื่อมต่อ Credentials
                </button>
              </div>
            </div>

            {/* Webhook Origin Notice if Localhost / Missing Tunnel */}
            {lineStatus.credentialsVerified && !lineStatus.isPublicWebhookConfigured && (
              <div className="p-5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-sm space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  ยืนยัน LINE Credentials สำเร็จแล้ว แต่ยังไม่มี Public HTTPS Webhook URL สำหรับเชื่อมต่อ LINE
                </div>
                <p className="text-xs text-amber-700 leading-relaxed">
                  เนื่องจาก LINE Platform ต้องการ Webhook URL ที่เข้าถึงได้สาธารณะผ่าน HTTPS (เช่น Cloudflare Tunnel หรือ Domain หลัก) กรุณาตั้งค่าระบบ Public HTTPS Webhook URL หรือรัน Cloudflare Tunnel เพื่อดำเนินการต่อ
                </p>
              </div>
            )}

            {/* Webhook Endpoint Display & Lifecycle */}
            {lineStatus.credentialsVerified && lineStatus.isPublicWebhookConfigured && webhookUrl && (
              <div className="space-y-4 p-6 bg-white rounded-2xl border border-slate-200">
                <label className="block text-xs font-bold text-slate-700">Webhook URL สำหรับนำไประบุใน LINE Developers Console</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 font-mono text-xs bg-slate-50 text-slate-700 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(webhookUrl)}
                    className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs shrink-0 flex items-center gap-1.5 transition-all"
                  >
                    {copiedWebhook ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    {copiedWebhook ? 'คัดลอกแล้ว' : 'คัดลอก'}
                  </button>
                </div>

                {/* 4-Checklist Readiness Items */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-center gap-2 text-xs font-bold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    1. Credentials Verified
                  </div>
                  <div className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-bold ${
                    lineStatus.webhookEndpointSet ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    {lineStatus.webhookEndpointSet ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Clock className="w-4 h-4 shrink-0" />}
                    2. Webhook Endpoint Set
                  </div>
                  <div className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-bold ${
                    lineStatus.webhookTestSucceeded ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    {lineStatus.webhookTestSucceeded ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Clock className="w-4 h-4 shrink-0" />}
                    3. Webhook Test Succeeded
                  </div>
                  <div className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-bold ${
                    lineStatus.webhookActive ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    {lineStatus.webhookActive ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Clock className="w-4 h-4 shrink-0" />}
                    4. Webhook Active / Use webhook
                  </div>
                </div>

                {!lineStatus.webhookActive && lineStatus.webhookEndpointSet && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-amber-900">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      Webhook เชื่อมต่อแล้ว แต่ยังไม่ได้เปิด Use webhook
                    </div>
                    <p>กรุณาไปที่ LINE Developers Console → Messaging API → Webhook settings แล้วกดเปิด <strong>Use webhook</strong> จากนั้นกดปุ่ม "ตรวจสอบอีกครั้ง"</p>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    data-testid="button-set-line-webhook"
                    onClick={handleSetLineWebhook}
                    disabled={lineVerifying}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
                  >
                    ตั้งค่า Webhook URL
                  </button>
                  <button
                    type="button"
                    data-testid="button-test-line-webhook"
                    onClick={handleTestLineWebhook}
                    disabled={lineVerifying}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
                  >
                    ทดสอบและตรวจสอบอีกครั้ง
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 6: Package & Finalization */}
        {currentStep === 6 && (
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200/80 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-indigo-600" />
                ขั้นตอนที่ 6: เลือกแพ็กเกจและยืนยันการเปิดใช้งาน
              </h2>
              <p className="text-slate-500 text-sm mt-1">ตรวจสอบสิทธิ์ใช้งานฟรี พร้อมเลือกแพ็กเกจที่เหมาะสมสำหรับหอพักของคุณ</p>
            </div>

            {/* Trial & Promo Info */}
            <div className="p-6 bg-gradient-to-br from-indigo-50 via-blue-50 to-indigo-100/60 border border-indigo-200 rounded-2xl space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-indigo-600 text-white mb-2">
                    สิทธิ์พิเศษสำหรับหอพักแรก
                  </span>
                  <h3 className="text-lg font-bold text-slate-900">รับสิทธิ์ทดลองใช้งาน HorPlus PRO ฟรี 1 เดือนเต็ม!</h3>
                  <p className="text-xs text-slate-600 mt-1">ใช้ได้ทุกฟีเจอร์ระดับพรีเมียมโดยยังไม่มีการเก็บเงิน</p>
                </div>
              </div>

              {/* Promo Code Input */}
              <div className="pt-3 border-t border-indigo-200/80 space-y-2">
                <label className="block text-xs font-bold text-slate-700">มีรหัสโปรโมชันใช่ไหม? (กรอก "HORPLUS" เพื่อรับสิทธิ์เพิ่ม 2 เดือน)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    data-testid="input-promo-code"
                    value={promoCodeInput}
                    onChange={e => setPromoCodeInput(e.target.value.toUpperCase())}
                    placeholder="กรอกรหัสโปรโมชัน HORPLUS"
                    className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-bold tracking-wider uppercase bg-white w-64"
                  />
                  <button
                    type="button"
                    data-testid="button-apply-promo"
                    onClick={handleApplyPromoCode}
                    disabled={promoApplying}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
                  >
                    {promoApplying ? 'กำลังตรวจสอบ...' : 'ใช้รหัส'}
                  </button>
                </div>
                {promoSuccess && <div className="text-xs font-bold text-emerald-700 mt-1">{promoSuccess}</div>}
                {promoError && <div className="text-xs font-bold text-rose-600 mt-1">{promoError}</div>}
              </div>
            </div>

            {/* Catalog Package List */}
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-800">แพ็กเกจที่ได้รับการรับรอง</label>
              {catalogLoading ? (
                <div className="p-8 text-center text-slate-500 text-sm">กำลังโหลดข้อมูลแพ็กเกจ...</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {catalogPackages.map(pkg => {
                    const isSelected = selectedPackageId === pkg.id;
                    return (
                      <div
                        key={pkg.id}
                        data-testid="plan-card-pro"
                        onClick={() => setSelectedPackageId(pkg.id)}
                        className={`p-5 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${
                          isSelected 
                            ? 'border-indigo-600 bg-indigo-50/40 shadow-sm' 
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
                          }`}>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 text-base">HorPlus PRO ({pkg.durationMonths || 1} เดือน)</div>
                            <div className="text-xs text-slate-500 mt-0.5">รองรับสูงสุด 150 ห้องพัก • โควตาข้อความ 30 ข้อความ/เดือน</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-extrabold text-indigo-600">{pkg.price || 189} THB</div>
                          <div className="text-[10px] font-semibold text-slate-400">สร้างความตั้งใจชำระเงิน (PENDING_PAYMENT)</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Navigation Controls */}
        <div className="mt-8 flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-slate-200/80">
          <button
            type="button"
            onClick={handlePrevStep}
            disabled={currentStep === 1}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            ย้อนกลับ
          </button>

          {currentStep < 6 ? (
            <button
              type="button"
              data-testid="button-next-step"
              onClick={handleNextStep}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm shadow-md shadow-indigo-200 transition-all"
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
              className="inline-flex items-center gap-2 px-8 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold text-sm shadow-lg shadow-indigo-200 transition-all disabled:opacity-50"
            >
              {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              ยืนยันสร้างหอพัก
            </button>
          )}
        </div>
      </div>

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
