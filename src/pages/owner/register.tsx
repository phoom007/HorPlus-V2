export function mapRegistrationBuildingForFinalize(
  b: any,
  idx: number,
  fallbackDeposit?: number | string
) {
  const bName = (b.name && b.name.trim()) ? b.name.trim() : '';
  const rawPrefix = (b.roomPrefix ? b.roomPrefix.trim() : '');
  const effectiveName = bName || (rawPrefix ? `อาคาร ${rawPrefix}` : `อาคาร ${idx + 1}`);
  const effectivePrefix = rawPrefix || bName || null;
  const fallback = Number(fallbackDeposit) || 0;

  const termDep = b.termDeposit !== undefined && b.termDeposit !== '' ? (Number(b.termDeposit) || 0) : (b.securityDeposit !== undefined && b.securityDeposit !== '' ? (Number(b.securityDeposit) || 0) : fallback);
  const monthlyDep = b.monthlyDeposit !== undefined && b.monthlyDeposit !== '' ? (Number(b.monthlyDeposit) || 0) : (b.securityDeposit !== undefined && b.securityDeposit !== '' ? (Number(b.securityDeposit) || 0) : fallback);
  const dailyDep = b.dailyDeposit !== undefined && b.dailyDeposit !== '' ? (Number(b.dailyDeposit) || 0) : (b.securityDeposit !== undefined && b.securityDeposit !== '' ? (Number(b.securityDeposit) || 0) : fallback);

  return {
    id: b.id || `bld-${idx + 1}`,
    name: effectiveName,
    code: effectivePrefix,
    floorsCount: Number(b.totalFloors) || 1,
    roomsPerFloor: b.roomsPerFloor !== '' ? Number(b.roomsPerFloor) : null,
    roomPrefix: effectivePrefix,
    hasElevator: b.hasElevator ?? false,
    numberingPattern: b.formatPattern || null,
    description: `อาคาร ${effectiveName}`,
    monthlyRent: Number(b.rentRates?.monthly) || 0,
    dailyRent: b.rentRates?.daily ? Number(b.rentRates.daily) : null,
    termRent: b.rentRates?.term ? Number(b.rentRates.term) : null,
    termMonths: Number(b.rentRates?.termMonths) || 4,
    maxInstallmentMonths: Number(b.rentRates?.maxInstallmentMonths) || 2,
    termDeposit: termDep,
    monthlyDeposit: monthlyDep,
    dailyDeposit: dailyDep,
    depositAmount: monthlyDep,
    securityDeposit: monthlyDep,
    maximumOccupants: Number(b.rentRates?.maxOccupants) || 2,
  };
}

import { formatBuildingDisplayName } from '../../lib/roomRentalSummary';
import { normalizeRoomIdentifier } from '../../lib/roomNormalizer';
import {
  TieredRateEditor,
  WATER_TIER_PRESET,
  ELECTRICITY_TIER_PRESET,
  CanonicalTierRecord,
  validateCanonicalTiers,
  normalizeCanonicalTiers,
} from '../../components/settings/TieredRateEditor';

export const mapRegisterUtilityMode = (mode: string): string => {
  switch (mode) {
    case 'unit':
      return 'per_unit';
    case 'person':
      return 'per_person';
    case 'room':
      return 'flat_rate';
    case 'tiered':
      return 'tiered';
    default:
      return 'flat_rate';
  }
};
import React, { useState, useRef } from 'react';
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
  PenTool,
  Send,
  Zap,
  Droplet,
  Wifi,
  Sparkles,
  Dog,
  Cat,
  Bird,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  Save,
  Check,
  RefreshCw,
  Info,
  Users,
  SlidersHorizontal,
  Edit3,
  X,
  Building as BuildingIcon,
  Share2,
  Search,
  Video,
  Megaphone,
  MessageSquare,
  Copy,
  Coins,
  Lock,
  Gift,
  Tag,
  Bot,
  Loader2,
  Upload,
} from 'lucide-react';

import { onboardingClient } from '../../data/onboardingClient';
import { AuthContext } from '../../router/guards';
import { Dormitory, Building, Room } from '../../types';
import { normalizeNumericInput } from '../../utils/numericInput';
import { createPortal } from 'react-dom';
import { saveRegistrationDraft, getRegistrationDraft, clearRegistrationDraft } from '../../utils/localDraftStorage';

interface RegisterProps {
  onAddLog?: (action: string, details: string, module: string, targetId?: string) => void;
  onNavigate?: (tab: string) => void;
  mode?: 'initial' | 'add_dorm';
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
  'ออมสิน (GSBk)',
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

// Formatting helpers for Phone, ID Card, and Bank Account
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
  const digits = val.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 9)}-${digits.slice(9)}`;
};

// 10 Preset Dormitory Rules for Quick Insertion
const PRESET_DORM_RULES = [
  { id: 'quiet_hours', label: '🤫 งดส่งเสียงดังหลัง 22:00', text: '• ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.' },
  { id: 'no_smoking', label: '🚭 ห้ามสูบบุหรี่ในห้องพัก', text: '• ห้ามสูบบุหรี่ บุหรี่ไฟฟ้า และสิ่งเสพติดภายในห้องพักและทางเดินโดยเด็ดขาด' },
  { id: 'no_pets_strict', label: '🐾 ห้ามเลี้ยงสัตว์เลี้ยง', text: '• ห้ามนำสัตว์เลี้ยงทุกชนิดเข้ามาเลี้ยงภายในห้องพักและพื้นที่ส่วนกลาง' },
  { id: 'trash_disposal', label: '🗑️ มัดถุงขยะทิ้งจุดกำหนด', text: '• กรุณามัดถุงขยะให้เรียบร้อยและนำไปทิ้ง ณ จุดทิ้งขยะของหอพักเท่านั้น' },
  { id: 'parking_rule', label: '🚗 จอดรถในซองที่กำหนด', text: '• จอดรถยนต์และจักรยานยนต์ในซองจอดที่กำหนด พร้อมติดสติ๊กเกอร์หอพัก' },
  { id: 'electric_appliance', label: '⚡ ห้ามดัดแปลงระบบไฟฟ้า', text: '• ห้ามดัดแปลงระบบไฟฟ้าหรือใช้เครื่องใช้ไฟฟ้าที่กินกำลังไฟสูงเกินมาตรฐาน' },
  { id: 'keycard_return', label: '🗝️ คืนกุญแจเมื่อย้ายออก', text: '• เมื่อสิ้นสุดสัญญาต้องคืนคีย์การ์ดและกุญแจห้องครบตามจำนวน (หากสูญหายปรับ 500 บ.)' },
  { id: 'visitor_policy', label: '👥 ห้ามคนนอกค้างคืนโดยไม่แจ้ง', text: '• ห้ามบุคคลภายนอกเข้าพักค้างคืนเกิน 2 คืนโดยไม่ได้รับอนุมัติจากเจ้าของหอพัก' },
  { id: 'cleanliness', label: '🧹 รักษาความสะอาดห้องพัก', text: '• ผู้เช่าต้องดูแลรักษาความสะอาดภายในห้องพัก ไม่ปล่อยให้เกิดกลิ่นหรือคราบสกปรก' },
  { id: 'safety_lock', label: '🔐 ล็อคประตูและดูแลทรัพย์สิน', text: '• กรุณาล็อคประตูห้องพักทุกครั้งเมื่อออกไปข้างนอก ทางหอพักไม่รับผิดชอบกรณีทรัพย์สินสูญหาย' }
];

interface DormitoryLogoUploaderProps {
  provisionalDormitoryId: string | null;
  ensureProvisionalDormitoryId: () => Promise<string>;
  logoUrl: string | null;
  onLogoChange: (newLogoUrl: string | null) => void;
  onError: (msg: string) => void;
}

export const DormitoryLogoUploader: React.FC<DormitoryLogoUploaderProps> = ({
  ensureProvisionalDormitoryId,
  logoUrl,
  onLogoChange,
  onError,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onError('รองรับเฉพาะไฟล์รูปภาพประเภท PNG, JPG และ WebP เท่านั้น');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      onError('ขนาดไฟล์ต้องไม่เกิน 5MB');
      return;
    }

    try {
      setIsUploading(true);
      const dormId = await ensureProvisionalDormitoryId();
      const body = new FormData();
      body.append('file', file);

      const res = await fetch(`/api/v1/dormitories/${dormId}/logo`, {
        method: 'POST',
        body,
        credentials: 'include',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || 'เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ');
      }

      onLogoChange(`${data.data.logoUrl}?t=${Date.now()}`);
    } catch (err: any) {
      console.error('[LOGO_UPLOAD_FAILED]', err);
      onError(err.message || 'ไม่สามารถอัปโหลดโลโก้ได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    try {
      setIsUploading(true);
      const dormId = await ensureProvisionalDormitoryId();
      await fetch(`/api/v1/dormitories/${dormId}/logo`, {
        method: 'DELETE',
        credentials: 'include',
      });
      onLogoChange(null);
    } catch (err: any) {
      console.error('[LOGO_DELETE_FAILED]', err);
      onLogoChange(null);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-bold text-slate-700">
          โลโก้หอพัก <span className="text-[10px] text-slate-400 font-normal">(ไม่บังคับ)</span>
        </label>
        {logoUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isUploading}
            className="text-[11px] font-bold text-rose-500 hover:text-rose-600 cursor-pointer flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>ลบโลโก้</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {logoUrl ? (
        <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-2xl">
          <div className="w-16 h-16 rounded-xl border border-slate-100 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
            <img src={logoUrl} alt="Dormitory Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-800">มีโลโก้หอพักแล้ว</p>
            <p className="text-[10px] text-slate-400">รูปภาพนี้จะแสดงในส่วนหัวและเมนูเลือกหอพัก</p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition cursor-pointer shrink-0"
          >
            เปลี่ยนรูป
          </button>
        </div>
      ) : (
        <div
          onClick={() => !isUploading && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition flex flex-col items-center justify-center gap-1.5 ${
            isDragOver
              ? 'border-blue-500 bg-blue-50/50'
              : 'border-slate-200 hover:border-blue-400 bg-white hover:bg-slate-50/50'
          } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          ) : (
            <Upload className="w-6 h-6 text-slate-400" />
          )}
          <div className="text-xs font-bold text-slate-700">
            {isUploading ? 'กำลังอัปโหลด...' : 'คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่'}
          </div>
          <div className="text-[10px] text-slate-400">รองรับไฟล์ PNG, JPG หรือ WebP ขนาดไม่เกิน 5MB</div>
        </div>
      )}
    </div>
  );
};

export const OwnerRegister: React.FC<RegisterProps> = ({ onAddLog, onNavigate, mode = 'initial' }) => {
  const authContext = React.useContext(AuthContext);
  const authUserName = authContext?.user?.name || authContext?.user?.displayName || authContext?.name || '';
  const [currentStep, setCurrentStep] = useState(1);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<{ [bId: string]: string }>({});

  // Terms Modal & Referral Source states
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [referralSource, setReferralSource] = useState('');
  const [referralOtherText, setReferralOtherText] = useState('');

  // Room editing states
  const [editingRoom, setEditingRoom] = useState<{ bIdx: number; oldRoom: string; newRoom: string } | null>(null);
  const [bulkEditingBuildingIdx, setBulkEditingBuildingIdx] = useState<number | null>(null);
  const [bulkRoomsInputText, setBulkRoomsInputText] = useState<string>('');

  // Helper to generate room numbers list
  const getGeneratedRooms = (b: {
    name?: string;
    totalFloors: number | string;
    roomsPerFloor: number | string;
    roomPrefix?: string;
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
    const prefix = (b.name && b.name.trim()) ? b.name.trim() : (b.roomPrefix ? b.roomPrefix.trim() : '');
    const maxFloors = Number(b.totalFloors) || 0;
    const maxRooms = Number(b.roomsPerFloor) || 0;

    for (let floor = 1; floor <= maxFloors; floor++) {
      for (let rm = 1; rm <= maxRooms; rm++) {
        const rmStr = rm < 10 ? `0${rm}` : `${rm}`;
        let roomNum = '';

        switch (b.formatPattern) {
          case 'prefix_floor_room': // A101 / สมบูรณ์101
            roomNum = `${prefix}${floor}${rmStr}`;
            break;
          case 'floor_room': // 101
            roomNum = `${floor}${rmStr}`;
            break;
          case 'prefix_floor_slash_room': // A1/1 / สมบูรณ์1/1
            roomNum = `${prefix}${floor}/${rm}`;
            break;
          case 'floor_slash_room': // 1/1
            roomNum = `${floor}/${rm}`;
            break;
          case 'prefix_dash_floor_room': // A-101 / สมบูรณ์-101
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

  // Load existing configuration or defaults
  const getInitialForm = () => {
    const defaultData = {
      // 1. Owner & Dorm Info (Clean baseline)
      dormName: '',
      dormAddress: '',
      province: 'กรุงเทพมหานคร',
      dormType: 'หอพักนักเรียน/นักศึกษา',
      genderType: 'รวม',
      logoUrl: null as string | null,
      hasLogo: false,

      // 2. Buildings & Flexible Structure
      buildings: [
        {
          id: 'b-1',
          name: '',
          totalFloors: 1 as number | string,
          roomsPerFloor: 0 as number | string,
          hasElevator: false,
          roomPrefix: '',
          formatPattern: 'prefix_floor_room',
          mode: 'auto' as 'auto' | 'manual',
          customRooms: [] as string[],
          termDeposit: 0 as number | string,
          monthlyDeposit: 0 as number | string,
          dailyDeposit: 0 as number | string,
          securityDeposit: 0 as number | string,
          rentRates: {
            monthly: 0 as number | string,
            term: 0 as number | string,
            termMonths: 4 as number | string,
            maxInstallmentMonths: 2 as number | string,
            daily: 0 as number | string,
            maxOccupants: 2 as number | string
          }
        }
      ],

      // 3. Utilities & Service Rates (Approved Step 3 defaults)
      utilities: {
        waterBillingMode: 'person', // 'unit' | 'person' | 'room' | 'tiered' (default: person)
        waterRate: 0 as number | string,
        waterTierRates: WATER_TIER_PRESET as CanonicalTierRecord[],
        waterTierReviewed: false,

        electricBillingMode: 'unit', // 'unit' | 'person' | 'room' | 'tiered' (default: unit)
        electricRate: 0 as number | string,
        electricityTierRates: ELECTRICITY_TIER_PRESET as CanonicalTierRecord[],
        electricityTierReviewed: false,

        commonFeeMode: 'room', // 'room' | 'person' (default: room)
        commonFeeRate: 0 as number | string,

        internetFeeMode: 'person', // 'person' | 'room' | 'free' (default: person)
        internetRate: 0 as number | string,

        parkingFeeMode: 'room', // 'room' | 'free' (default: room)
        parkingFeeRate: 0 as number | string
      },

      // 4. Deposits, Late Fees & Payment Account
      deposits: {
        securityDeposit: 0 as number | string,
        advanceRentMonths: 1,
        dueDateDay: 15 as number | string,
        gracePeriodDays: 2,
        lateFeeType: 'none', // 'none' | 'per_day' | 'fixed_once' (default: none)
        lateFeeAmount: 0 as number | string
      },

      paymentAccount: {
        bankName: '',
        accountNumber: '',
        accountName: '',
        bankAccountName: '',
        promptPayId: '',
        promptPayName: ''
      },

      // 5. Pets, Rules & Signature
      petPolicy: {
        allowed: 'none', // 'none' | 'free' | 'conditional' (default: none)
        allowedTypes: []
      },
      ownerSignatureUrl: '',
      rulesTemplate: '',

      // 6. LINE OA
      lineOA: {
        oaName: '',
        channelId: '',
        channelSecret: '',
        isConnected: false,
        botDisplayName: '',
        botPictureUrl: '',
        lineOaId: ''
      }
    };

    return defaultData;
  };

  const [formData, setFormData] = useState(getInitialForm());
  const [testingLine, setTestingLine] = useState(false);
  const [lineStatusMsg, setLineStatusMsg] = useState<{ type: 'success' | 'error'; msg: string } | null>(
    formData.lineOA.isConnected ? { type: 'success', msg: 'เชื่อมต่อกับ LINE Official Account สำเร็จ (พร้อมใช้งาน)' } : null
  );

  // Plan Selection & Promo Code states for Step 7
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'pro'>('pro');
  const [promoCodeInput, setPromoCodeInput] = useState('HORPLUS');
  const [validatedPromoCode, setValidatedPromoCode] = useState<string | undefined>(undefined);
  const [promoBenefitUnit, setPromoBenefitUnit] = useState<string | null>(null);
  const [promoBenefitValue, setPromoBenefitValue] = useState<number | null>(null);
  const [promoBenefitLabel, setPromoBenefitLabel] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [isCheckingPromo, setIsCheckingPromo] = useState(false);

  // Packages, Referral & Coin Wallet states
  const [packages, setPackages] = useState<any[]>([]);
  const [selectedDurationMonths, setSelectedDurationMonths] = useState<number>(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [isReferralBound, setIsReferralBound] = useState(false);
  const [isCheckingReferral, setIsCheckingReferral] = useState(false);
  const [referralInlineError, setReferralInlineError] = useState<string | null>(null);
  const [referralInlineSuccess, setReferralInlineSuccess] = useState<string | null>(null);
  const [coinWalletBalance, setCoinWalletBalance] = useState(0);
  const [coinToApply, setCoinToApply] = useState(0);
  const [isFirstTrialEligible, setIsFirstTrialEligible] = useState<boolean | null>(null);

  const formatPrice = (val: number | string | undefined | null) => {
    if (val === undefined || val === null || isNaN(Number(val))) return '0';
    return Number(val).toLocaleString('en-US');
  };

  // Trial UI state (fails closed: unknown/loading -> available / unavailable / error)
  const [trialState, setTrialState] = useState<'unknown' | 'available' | 'unavailable' | 'error'>('unknown');
  const [accountTrialAvailable, setAccountTrialAvailable] = useState<boolean | null>(null);
  const [quoteSummary, setQuoteSummary] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [provisionalDormitoryId, setProvisionalDormitoryId] = useState<string | null>(null);

  const userId = authContext?.user?.id || 'current_user';
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Restore local draft on mount (survives F5)
  React.useEffect(() => {
    let isMounted = true;
    const loadDraft = async () => {
      try {
        const draft = await getRegistrationDraft(userId, mode || 'initial');
        if (!isMounted || !draft) {
          setDraftLoaded(true);
          return;
        }

        if (draft.currentStep && draft.currentStep >= 1 && draft.currentStep <= 7) {
          setCurrentStep(draft.currentStep);
        }
        if (draft.formData) {
          const restoredBuildings = Array.isArray(draft.formData.buildings)
            ? draft.formData.buildings.map((b: any) => {
              const rawName = (typeof b.name === 'string' ? b.name : '').trim();
              const rawPrefix = (typeof b.roomPrefix === 'string' ? b.roomPrefix : '').trim();
              const effectiveName = rawName || rawPrefix || '';
              const legacyDep = b.securityDeposit !== undefined && b.securityDeposit !== '' ? b.securityDeposit : (draft.formData?.deposits?.securityDeposit ?? 0);
              const termDep = b.termDeposit !== undefined && b.termDeposit !== '' ? b.termDeposit : legacyDep;
              const monthlyDep = b.monthlyDeposit !== undefined && b.monthlyDeposit !== '' ? b.monthlyDeposit : legacyDep;
              const dailyDep = b.dailyDeposit !== undefined && b.dailyDeposit !== '' ? b.dailyDeposit : legacyDep;

              return {
                ...b,
                name: effectiveName,
                roomPrefix: rawPrefix,
                termDeposit: termDep,
                monthlyDeposit: monthlyDep,
                dailyDeposit: dailyDep,
                securityDeposit: monthlyDep,
              };
            })
            : undefined;

          setFormData(prev => ({
            ...prev,
            ...draft.formData,
            utilities: {
              ...prev.utilities,
              ...(draft.formData.utilities || {}),
              waterTierRates: draft.formData.utilities?.waterTierRates || prev.utilities.waterTierRates,
              electricityTierRates: draft.formData.utilities?.electricityTierRates || prev.utilities.electricityTierRates,
            },
            ...(restoredBuildings ? { buildings: restoredBuildings } : {}),
            // Never restore sensitive channelSecret
            lineOA: {
              ...prev.lineOA,
              ...(draft.formData.lineOA || {}),
              channelSecret: '',
            },
            // Preserve user-selected dueDateDay if present, else fallback to 15
            deposits: {
              ...prev.deposits,
              ...(draft.formData.deposits || {}),
              dueDateDay: (draft.formData.deposits?.dueDateDay !== undefined && draft.formData.deposits?.dueDateDay !== '' && !isNaN(Number(draft.formData.deposits?.dueDateDay)))
                ? Number(draft.formData.deposits.dueDateDay)
                : (prev.deposits.dueDateDay || 15),
            },
          }));
        }
        if (draft.selectedPlan) setSelectedPlan(draft.selectedPlan);
        if (draft.selectedDurationMonths) setSelectedDurationMonths(draft.selectedDurationMonths);
        if (draft.selectedPackageId) setSelectedPackageId(draft.selectedPackageId);
        if (draft.promoCodeInput) setPromoCodeInput(draft.promoCodeInput);
        if (draft.referralCodeInput) setReferralCodeInput(draft.referralCodeInput);
        if (draft.provisionalDormitoryId) setProvisionalDormitoryId(draft.provisionalDormitoryId);
      } catch (err) {
        console.warn('Failed to restore local draft:', err);
      } finally {
        if (isMounted) setDraftLoaded(true);
      }
    };
    loadDraft();
    return () => { isMounted = false; };
  }, [userId, mode]);

  // Debounced auto-save of registration draft (local-first, 0 network requests)
  React.useEffect(() => {
    if (!draftLoaded) return;
    const timer = setTimeout(() => {
      saveRegistrationDraft(userId, mode || 'initial', {
        currentStep,
        formData,
        selectedPlan,
        selectedDurationMonths,
        selectedPackageId,
        promoCodeInput,
        referralCodeInput,
        provisionalDormitoryId,
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [currentStep, formData, selectedPlan, selectedDurationMonths, selectedPackageId, promoCodeInput, referralCodeInput, provisionalDormitoryId, userId, mode, draftLoaded]);

  // Prevent background scrolling while success overlay is shown
  React.useEffect(() => {
    if (isSavedSuccess && typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    } else if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
      }
    };
  }, [isSavedSuccess]);

  const ensureProvisionalDormitoryId = async (): Promise<string> => {
    if (provisionalDormitoryId) return provisionalDormitoryId;
    const prep = await onboardingClient.prepare({
      name: formData.dormName || 'หอพักใหม่',
      addressLine1: formData.dormAddress || '',
      province: formData.province || 'กรุงเทพมหานคร',
    });
    const provId = prep?.provisionalDormitoryId || prep?.data?.provisionalDormitoryId;
    if (!provId) {
      throw new Error('ไม่สามารถเตรียมข้อมูลหอพักชั่วคราวได้ กรุณาลองใหม่อีกครั้ง');
    }
    setProvisionalDormitoryId(provId);
    return provId;
  };

  // Load packages, referral param, and coin balance on mount
  React.useEffect(() => {
    const initData = async () => {
      try {
        const pkgRes = await onboardingClient.getPackages();
        if (pkgRes?.data?.packages) {
          setPackages(pkgRes.data.packages);
          const pkg1mo = pkgRes.data.packages.find((p: any) => p.durationMonths === 1);
          if (pkg1mo) setSelectedPackageId(pkg1mo.id);
        }
      } catch (err) {
        console.warn('Failed to load packages:', err);
      }

      try {
        const walletRes = await onboardingClient.getCoinWallet();
        if (walletRes?.data) {
          setCoinWalletBalance(walletRes.data.balance || 0);
        }
      } catch (err) {
        console.warn('Failed to load coin wallet:', err);
      }

      // Parse and bind ?ref= URL parameter or sessionStorage referral code
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const refParam = urlParams.get('ref') || sessionStorage.getItem('horplus_referral_code');
        if (refParam && /^\d{6}$/.test(refParam)) {
          setReferralCodeInput(refParam);
          const valRes = await onboardingClient.validateReferral(refParam);
          if (valRes?.data?.valid) {
            setIsReferralBound(true);
          }
        }
      } catch (err) {
        console.warn('Failed to validate referral param:', err);
      }
    };

    initData();
  }, []);

  // Fetch live price quote when on Step 7 (Fails closed before server confirmation)
  React.useEffect(() => {
    if (currentStep !== 7) return;
    let isCancelled = false;

    const fetchQuote = async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const provId = await ensureProvisionalDormitoryId();
        const quote = await onboardingClient.getSubscriptionQuote({
          isFreePlan: selectedPlan === 'free',
          packageId: selectedPlan === 'pro' ? (selectedPackageId || undefined) : undefined,
          promoCode: appliedPromo && validatedPromoCode ? validatedPromoCode : undefined,
          referralCode: isReferralBound && referralCodeInput ? referralCodeInput.trim() : undefined,
          coinRequested: coinToApply,
          dormitoryId: provId,
        });
        if (isCancelled) return;
        if (quote?.data) {
          setQuoteSummary(quote.data);
          if (quote.data.promoBenefitUnit || quote.data.promoBenefitLabel) {
            setPromoBenefitUnit(quote.data.promoBenefitUnit || 'MONTH');
            setPromoBenefitValue(quote.data.promoBenefitValue ?? (quote.data.promoBenefitUnit === 'DAY' ? 0 : 2));
            setPromoBenefitLabel(quote.data.promoBenefitLabel || (quote.data.promoBenefitUnit === 'DAY' ? `${quote.data.promoBenefitValue} วัน` : `${quote.data.promoBenefitValue || 2} เดือน`));
          }
          if (quote.data.accountTrialAvailable !== undefined) {
            const isAvail = Boolean(quote.data.accountTrialAvailable);
            setAccountTrialAvailable(isAvail);
            setTrialState(isAvail ? 'available' : 'unavailable');
          } else if (quote.data.isTrialEligible !== undefined && selectedDurationMonths === 1) {
            const isAvail = Boolean(quote.data.isTrialEligible);
            setAccountTrialAvailable(isAvail);
            setTrialState(isAvail ? 'available' : 'unavailable');
          } else {
            setAccountTrialAvailable(false);
            setTrialState('unavailable');
          }
          if (quote.data.isTrialEligible !== undefined) {
            setIsFirstTrialEligible(quote.data.isTrialEligible);
          }
        } else {
          setTrialState('error');
          setQuoteError('ไม่สามารถดึงข้อมูลราคาแพ็กเกจได้');
        }
      } catch (err: any) {
        if (isCancelled) return;
        console.warn('Failed to fetch quote:', err);
        setTrialState('error');
        setQuoteError(err?.message || 'เกิดข้อผิดพลาดในการโหลดใบเสนอราคา');
      } finally {
        if (!isCancelled) {
          setQuoteLoading(false);
        }
      }
    };
    fetchQuote();

    return () => {
      isCancelled = true;
    };
  }, [currentStep, selectedPlan, selectedPackageId, appliedPromo, validatedPromoCode, isReferralBound, referralCodeInput, coinToApply, selectedDurationMonths]);

  // Signature Canvas Drawing
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);

  // Restore signature to canvas if returning to step 5
  React.useEffect(() => {
    if (currentStep === 5 && formData.ownerSignatureUrl && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
        };
        img.src = formData.ownerSignatureUrl;
      }
    }
  }, [currentStep, formData.ownerSignatureUrl]);

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
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e293b';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setFormData(prev => ({ ...prev, ownerSignatureUrl: dataUrl }));
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFormData(prev => ({ ...prev, ownerSignatureUrl: '' }));
  };

  const handleCheckReferral = async () => {
    if (isCheckingReferral) return;
    if (!referralCodeInput || referralCodeInput.length !== 6) {
      setReferralInlineError('กรุณากรอกรหัสคำเชิญ 6 หลัก');
      setReferralInlineSuccess(null);
      return;
    }
    setIsCheckingReferral(true);
    setReferralInlineError(null);
    setReferralInlineSuccess(null);
    try {
      const res = await onboardingClient.validateReferral(referralCodeInput);
      if (res?.data?.valid) {
        setIsReferralBound(true);
        setReferralInlineSuccess('✓ ยืนยันรหัสคำเชิญสำเร็จ! ได้รับสิทธิ์ 10 Coins');
        setReferralInlineError(null);
      } else {
        setIsReferralBound(false);
        setReferralInlineError(res?.data?.message || 'ไม่พบรหัสคำเชิญนี้ในระบบ หรือรหัสไม่ถูกต้อง');
        setReferralInlineSuccess(null);
      }
    } catch (err: any) {
      setIsReferralBound(false);
      setReferralInlineError(err?.message || 'ไม่พบรหัสคำเชิญนี้ในระบบ หรือรหัสไม่ถูกต้อง');
      setReferralInlineSuccess(null);
    } finally {
      setIsCheckingReferral(false);
    }
  };

  const handleApplyPromo = async () => {
    if (isCheckingPromo) return;
    if (!promoCodeInput.trim()) {
      setPromoMessage('กรุณากรอกรหัสโปรโมชั่น');
      setValidatedPromoCode(undefined);
      setAppliedPromo(false);
      return;
    }
    setIsCheckingPromo(true);
    try {
      const codeToTest = promoCodeInput.trim().toUpperCase();
      const rawRes = await onboardingClient.validatePromo(codeToTest, selectedPlan.toUpperCase());
      const res = rawRes?.data ?? rawRes;
      if (res && res.valid) {
        setValidatedPromoCode(codeToTest);
        const unit = res.benefitUnit || 'MONTH';
        const val = res.benefitValue ?? (unit === 'DAY' ? 0 : 2);
        const label = res.benefitLabel || (unit === 'DAY' ? `${val} วัน` : `${val} เดือน`);
        setPromoBenefitUnit(unit);
        setPromoBenefitValue(val);
        setPromoBenefitLabel(label);
        setAppliedPromo(true);
        setPromoMessage(`✓ ใช้งานรหัส ${codeToTest} สำเร็จ! ${res.description || res.message || 'ได้รับสิทธิ์โปรโมชั่น'}`);
      } else {
        setValidatedPromoCode(undefined);
        setPromoBenefitUnit(null);
        setPromoBenefitValue(null);
        setPromoBenefitLabel(null);
        setAppliedPromo(false);
        setPromoMessage(res?.message || 'รหัสโปรโมชั่นไม่ถูกต้อง หรือหมดอายุแล้ว');
      }
    } catch (err: any) {
      setValidatedPromoCode(undefined);
      setPromoBenefitUnit(null);
      setPromoBenefitValue(null);
      setPromoBenefitLabel(null);
      setAppliedPromo(false);
      setPromoMessage(err?.message || 'รหัสโปรโมชั่นไม่ถูกต้อง หรือหมดอายุแล้ว');
    } finally {
      setIsCheckingPromo(false);
    }
  };

  const handleTestLineConnection = async () => {
    if (!formData.lineOA.channelId || !formData.lineOA.channelSecret) {
      setLineStatusMsg({ type: 'error', msg: 'กรุณากรอก Channel ID และ Channel Secret ให้ครบถ้วน' });
      return;
    }
    setTestingLine(true);
    setLineStatusMsg(null);
    try {
      const provDormId = await ensureProvisionalDormitoryId();
      const lineRes = await onboardingClient.updateLineConfig(provDormId, {
        channelId: formData.lineOA.channelId,
        channelSecret: formData.lineOA.channelSecret,
      });
      const botDisplayName = lineRes?.data?.botDisplayName || lineRes?.botDisplayName || '';
      const botPictureUrl = lineRes?.data?.botPictureUrl || lineRes?.botPictureUrl || '';
      const lineOaId = lineRes?.data?.lineOaId || lineRes?.lineOaId || '';

      setFormData(prev => ({
        ...prev,
        lineOA: {
          ...prev.lineOA,
          isConnected: true,
          botDisplayName,
          botPictureUrl,
          oaName: lineOaId || prev.lineOA.oaName
        }
      }));
      setLineStatusMsg({ type: 'success', msg: 'ทดสอบสำเร็จ: เชื่อมต่อ LINE Official Account สำเร็จ (พร้อมใช้งาน)' });
    } catch (err: any) {
      setFormData(prev => ({ ...prev, lineOA: { ...prev.lineOA, isConnected: false } }));
      setLineStatusMsg({ type: 'error', msg: err?.message || 'การเชื่อมต่อ LINE OA ล้มเหลว กรุณาตรวจสอบ Channel ID / Secret' });
    } finally {
      setTestingLine(false);
    }
  };

  const handleAddBuilding = () => {
    const newBuilding = {
      id: `b-${Date.now()}`,
      name: '',
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
        termMonths: 4,
        maxInstallmentMonths: 2,
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

  const validateStep = (stepNum: number): { valid: boolean; error?: string } => {
    if (stepNum === 1) {
      if (!formData.dormName || !formData.dormName.trim()) {
        return { valid: false, error: 'กรุณากรอก "ชื่อหอพัก / อพาร์ตเมนต์"' };
      }
      if (!formData.dormAddress || !formData.dormAddress.trim()) {
        return { valid: false, error: 'กรุณากรอก "ที่อยู่หอพัก"' };
      }
      if (!formData.province || !formData.province.trim()) {
        return { valid: false, error: 'กรุณาเลือก "จังหวัด"' };
      }
      if (!formData.dormType || !formData.dormType.trim()) {
        return { valid: false, error: 'กรุณาเลือก "ประเภทที่พัก"' };
      }
      if (!formData.genderType || !formData.genderType.trim()) {
        return { valid: false, error: 'กรุณาเลือก "ประเภทผู้พัก / เพศของหอพัก"' };
      }
    }

    if (stepNum === 2) {
      if (!formData.buildings || formData.buildings.length === 0) {
        return { valid: false, error: 'กรุณาเพิ่มอาคารอย่างน้อย 1 อาคาร' };
      }
      for (let i = 0; i < formData.buildings.length; i++) {
        const b = formData.buildings[i];
        const bLabel = (b.name && b.name.trim()) ? formatBuildingDisplayName(b.name) : (b.roomPrefix ? `อาคาร ${b.roomPrefix}` : `อาคารที่ ${i + 1}`);

        if (b.mode === 'auto') {
          if (!b.totalFloors || b.totalFloors <= 0) {
            return { valid: false, error: `กรุณากรอก "จำนวนชั้น" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
          }
          if (!b.roomsPerFloor || b.roomsPerFloor <= 0) {
            return { valid: false, error: `กรุณากรอก "ห้องต่อชั้น" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
          }
        }

        if (!b.rentRates?.maxOccupants || b.rentRates.maxOccupants <= 0) {
          return { valid: false, error: `กรุณากรอก "จำนวนผู้เข้าพักสูงสุด" ของ ${bLabel} ให้ถูกต้อง (อย่างน้อย 1 คน)` };
        }

        const rooms = getGeneratedRooms(b);
        if (rooms.length === 0) {
          return { valid: false, error: `${bLabel} ยังไม่มีเลขห้องพัก กรุณาสร้างอัตโนมัติหรือระบุเลขห้อง` };
        }
      }

      // Hard ceiling: max 150 rooms per dormitory across all buildings
      const totalRooms = formData.buildings.reduce((sum, b) => sum + getGeneratedRooms(b).length, 0);
      if (totalRooms > 150) {
        return { valid: false, error: 'หนึ่งหอพักสามารถสร้างห้องได้สูงสุด 150 ห้อง' };
      }

      // Dorm-wide room uniqueness check across all buildings
      const seenRooms = new Map<string, { roomNumber: string; buildingName: string }>();
      for (let i = 0; i < formData.buildings.length; i++) {
        const b = formData.buildings[i];
        const bLabel = (b.name && b.name.trim()) ? formatBuildingDisplayName(b.name) : (b.roomPrefix ? `อาคาร ${b.roomPrefix}` : `อาคารที่ ${i + 1}`);
        const rooms = getGeneratedRooms(b);
        for (const rNum of rooms) {
          const norm = normalizeRoomIdentifier(rNum);
          if (!norm) continue;
          if (seenRooms.has(norm)) {
            return {
              valid: false,
              error: `เลขห้อง "${rNum}" ซ้ำกับอาคารอื่น กรุณาเปลี่ยนเลขห้องหรือเลือกรูปแบบเลขห้องอื่น`,
            };
          }
          seenRooms.set(norm, { roomNumber: rNum, buildingName: bLabel });
        }
      }
    }

    if (stepNum === 3) {
      // Check utilities rates
      if (formData.utilities.waterBillingMode === 'tiered') {
        const wTiers = formData.utilities.waterTierRates || WATER_TIER_PRESET;
        if (!validateCanonicalTiers(wTiers)) {
          return { valid: false, error: 'กรุณากรอกอัตราค่าน้ำแบบขั้นบันไดให้ถูกต้อง' };
        }
      } else {
        if (isNaN(Number(formData.utilities.waterRate)) || Number(formData.utilities.waterRate) < 0) {
          return { valid: false, error: 'กรุณากรอก "ค่าน้ำ" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
        }
      }

      if (formData.utilities.electricBillingMode === 'tiered') {
        const eTiers = formData.utilities.electricityTierRates || ELECTRICITY_TIER_PRESET;
        if (!validateCanonicalTiers(eTiers)) {
          return { valid: false, error: 'กรุณากรอกอัตราค่าไฟฟ้าแบบขั้นบันไดให้ถูกต้อง' };
        }
      } else {
        if (isNaN(Number(formData.utilities.electricRate)) || Number(formData.utilities.electricRate) < 0) {
          return { valid: false, error: 'กรุณากรอก "ค่าไฟฟ้า" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
        }
      }
      if (formData.utilities.commonFeeMode !== 'free' && formData.utilities.commonFeeMode !== 'none') {
        if (isNaN(formData.utilities.commonFeeRate) || formData.utilities.commonFeeRate < 0) {
          return { valid: false, error: 'กรุณากรอก "ค่าส่วนกลาง" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
        }
      }
      if (formData.utilities.internetFeeMode !== 'free' && formData.utilities.internetFeeMode !== 'none') {
        if (isNaN(formData.utilities.internetRate) || formData.utilities.internetRate < 0) {
          return { valid: false, error: 'กรุณากรอก "ค่าอินเทอร์เน็ต" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
        }
      }
      if (formData.utilities.parkingFeeMode !== 'free') {
        if (isNaN(formData.utilities.parkingFeeRate) || formData.utilities.parkingFeeRate < 0) {
          return { valid: false, error: 'กรุณากรอก "ค่าจอดรถ" ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)' };
        }
      }

      // Check building rent rates
      for (let i = 0; i < formData.buildings.length; i++) {
        const b = formData.buildings[i];
        const bLabel = (b.name && b.name.trim()) ? formatBuildingDisplayName(b.name) : (b.roomPrefix ? `อาคาร ${b.roomPrefix}` : `อาคารที่ ${i + 1}`);
        const rates = b.rentRates;

        if (!rates || isNaN(rates.monthly) || rates.monthly <= 0) {
          return { valid: false, error: `กรุณากรอก "ค่าเช่ารายเดือน" ของ ${bLabel} ให้ถูกต้อง (ต้องมากกว่า 0)` };
        }
        if (isNaN(rates.daily) || rates.daily < 0) {
          return { valid: false, error: `กรุณากรอก "ค่าเช่ารายวัน" ของ ${bLabel} ให้ถูกต้อง` };
        }
        if (!rates.maxOccupants || rates.maxOccupants <= 0) {
          return { valid: false, error: `กรุณากรอก "จำนวนผู้เข้าพักสูงสุด" ของ ${bLabel} ให้ถูกต้อง (อย่างน้อย 1 คน)` };
        }
        if (rates.term !== undefined && (isNaN(rates.term) || rates.term < 0)) {
          return { valid: false, error: `กรุณากรอก "ค่าเช่ารายเทอม" ของ ${bLabel} ให้ถูกต้อง` };
        }
        if (rates.termMonths !== undefined && rates.termMonths <= 0) {
          return { valid: false, error: `กรุณากรอก "ระยะเวลาเทอม" ของ ${bLabel} ให้ถูกต้อง (อย่างน้อย 1 เดือน)` };
        }
      }
    }

    if (stepNum === 4) {
      // Check rental-mode deposits per building (0 is explicitly valid)
      for (let i = 0; i < formData.buildings.length; i++) {
        const b = formData.buildings[i];
        const bLabel = (b.name && b.name.trim()) ? formatBuildingDisplayName(b.name) : (b.roomPrefix ? `อาคาร ${b.roomPrefix}` : `อาคารที่ ${i + 1}`);

        const termDep = b.termDeposit !== undefined && b.termDeposit !== '' ? b.termDeposit : (b.securityDeposit !== undefined && b.securityDeposit !== '' ? b.securityDeposit : formData.deposits.securityDeposit);
        if (termDep === undefined || termDep === '' || isNaN(Number(termDep)) || Number(termDep) < 0) {
          return { valid: false, error: `กรุณากรอก "ค่าประกันรายเทอม" ของ ${bLabel} ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)` };
        }

        const monthlyDep = b.monthlyDeposit !== undefined && b.monthlyDeposit !== '' ? b.monthlyDeposit : (b.securityDeposit !== undefined && b.securityDeposit !== '' ? b.securityDeposit : formData.deposits.securityDeposit);
        if (monthlyDep === undefined || monthlyDep === '' || isNaN(Number(monthlyDep)) || Number(monthlyDep) < 0) {
          return { valid: false, error: `กรุณากรอก "ค่าประกันรายเดือน" ของ ${bLabel} ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)` };
        }

        const dailyDep = b.dailyDeposit !== undefined && b.dailyDeposit !== '' ? b.dailyDeposit : (b.securityDeposit !== undefined && b.securityDeposit !== '' ? b.securityDeposit : formData.deposits.securityDeposit);
        if (dailyDep === undefined || dailyDep === '' || isNaN(Number(dailyDep)) || Number(dailyDep) < 0) {
          return { valid: false, error: `กรุณากรอก "ค่าประกันรายวัน" ของ ${bLabel} ให้ถูกต้อง (ต้องเป็นตัวเลข >= 0)` };
        }
      }

      // Check due date day & late fee (strict 1-28 range)
      if (!formData.deposits.dueDateDay || formData.deposits.dueDateDay < 1 || formData.deposits.dueDateDay > 28) {
        return { valid: false, error: 'กรุณาเลือก "วันครบกำหนดชำระ" (วันที่ 1 - 28)' };
      }
      if (formData.deposits.lateFeeType !== 'none') {
        if (isNaN(formData.deposits.lateFeeAmount) || formData.deposits.lateFeeAmount < 0) {
          return { valid: false, error: 'กรุณากรอก "อัตราค่าปรับ" ให้ถูกต้อง' };
        }
      }

      // Check payment account details
      if (!formData.paymentAccount.bankName) {
        return { valid: false, error: 'กรุณาเลือก "ธนาคารที่รับโอน"' };
      }
      if (!formData.paymentAccount.accountNumber || !formData.paymentAccount.accountNumber.trim()) {
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

      // PromptPay checks (if PromptPay ID is entered)
      if (formData.paymentAccount.promptPayId && formData.paymentAccount.promptPayId.trim()) {
        const cleanPP = formData.paymentAccount.promptPayId.replace(/\D/g, '');
        if (cleanPP.length !== 10 && cleanPP.length !== 13) {
          return { valid: false, error: 'กรุณากรอก "เลขพร้อมเพย์" ให้ถูกต้อง (เบอร์โทร 10 หลัก หรือ เลขบัตรประชาชน 13 หลัก)' };
        }
        if (!formData.paymentAccount.promptPayName || !formData.paymentAccount.promptPayName.trim()) {
          return { valid: false, error: 'กรุณากรอก "ชื่อบัญชีพร้อมเพย์"' };
        }
      }
    }

    if (stepNum === 5) {
      if (!formData.petPolicy.allowed) {
        return { valid: false, error: 'กรุณาเลือก "เงื่อนไขการเลี้ยงสัตว์ในหอพัก"' };
      }
      if (formData.petPolicy.allowed === 'conditional') {
        if (!formData.petPolicy.allowedTypes || formData.petPolicy.allowedTypes.length === 0) {
          return { valid: false, error: 'กรุณาเลือก "ประเภทสัตว์ที่อนุญาต" อย่างน้อย 1 ประเภท' };
        }
      }
      if (!formData.rulesTemplate || !formData.rulesTemplate.trim()) {
        return { valid: false, error: 'กรุณาระบุ "ข้อตกลงสัญญา & ระเบียบโครงการ"' };
      }
      if (!formData.ownerSignatureUrl) {
        return { valid: false, error: 'กรุณาวาด "ลายเซ็นเจ้าของหอพัก" ก่อนดำเนินการต่อ' };
      }
    }

    if (stepNum === 6) {
      // Step 6 LINE OA is optional. Blank credentials can advance to Step 7 without error.
      return { valid: true };
    }


    if (stepNum === 7) {
      return { valid: true };
    }

    return { valid: true };
  };

  const handleNextStep = () => {
    const check = validateStep(currentStep);
    if (!check.valid) {
      setValidationError(check.error || 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    setValidationError(null);
    setCurrentStep(prev => Math.min(prev + 1, 7));
  };

  const handleStepClick = (stepNum: number) => {
    if (stepNum > currentStep) {
      for (let s = currentStep; s < stepNum; s++) {
        const check = validateStep(s);
        if (!check.valid) {
          setValidationError(check.error || 'กรุณากรอกข้อมูลให้ครบถ้วนก่อนสลับขั้นตอน');
          return;
        }
      }
    }
    setValidationError(null);
    setCurrentStep(stepNum);
  };

  const handleSaveRegistration = () => {
    const check = validateStep(currentStep);
    if (!check.valid) {
      setValidationError(check.error || 'กรุณากรอกข้อมูลให้ครบถ้วนก่อนบันทึก');
      return;
    }
    setValidationError(null);
    setShowTermsModal(true);
  };

  const handleConfirmTermsAndComplete = async () => {
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
    try {
      const finalSource = referralSource === 'other' ? `อื่นๆ (${referralOtherText.trim()})` : referralSource;

      // 1. Prepare / ensure provisional dormitory ID
      const provDormId = await ensureProvisionalDormitoryId();

      // 2. Upload Signature (Object storage path only - fail closed)
      if (formData.ownerSignatureUrl) {
        if (formData.ownerSignatureUrl.startsWith('data:')) {
          const uploadRes = await onboardingClient.uploadSignature(provDormId, formData.ownerSignatureUrl);
          const safeRef = uploadRes?.data?.url || uploadRes?.url || uploadRes?.data?.objectKey || uploadRes?.objectKey;
          if (safeRef) {
            setFormData(prev => ({ ...prev, ownerSignatureUrl: safeRef }));
          }
        }
      } else {
        throw new Error('กรุณาวาดและบันทึกลายเซ็นเจ้าของหอพักในขั้นตอนที่ 5 ก่อนยืนยันสร้างหอพัก');
      }

      // 3. Map Buildings
      const mappedBuildings = formData.buildings.map((b, idx) =>
        mapRegistrationBuildingForFinalize(b, idx, formData.deposits.securityDeposit)
      );

      // 4. Map Rooms
      const mappedRooms: any[] = [];
      formData.buildings.forEach((b) => {
        const roomNumbers = getGeneratedRooms(b);
        const rentRates = b.rentRates || { monthly: 0, term: 0, daily: 0, termMonths: 4, maxInstallmentMonths: 2, maxOccupants: 2 };
        const fallback = Number(formData.deposits.securityDeposit) || 0;
        const legacyDep = b.securityDeposit !== undefined && b.securityDeposit !== '' ? (Number(b.securityDeposit) || 0) : fallback;
        const termDep = b.termDeposit !== undefined && b.termDeposit !== '' ? (Number(b.termDeposit) || 0) : legacyDep;
        const monthlyDep = b.monthlyDeposit !== undefined && b.monthlyDeposit !== '' ? (Number(b.monthlyDeposit) || 0) : legacyDep;
        const dailyDep = b.dailyDeposit !== undefined && b.dailyDeposit !== '' ? (Number(b.dailyDeposit) || 0) : legacyDep;

        roomNumbers.forEach((rNum) => {
          const digitsOnly = rNum.replace(/\D/g, '');
          const calculatedFloor = digitsOnly ? (parseInt(digitsOnly.charAt(0)) || 1) : 1;
          mappedRooms.push({
            buildingId: b.id,
            roomNumber: rNum,
            floor: calculatedFloor,
            monthlyRent: Number(rentRates.monthly) || 0,
            dailyRent: rentRates.daily ? Number(rentRates.daily) : null,
            termRent: rentRates.term ? Number(rentRates.term) : null,
            termMonths: Number(rentRates.termMonths) || 4,
            termDeposit: termDep,
            monthlyDeposit: monthlyDep,
            dailyDeposit: dailyDep,
            depositAmount: monthlyDep,
            securityDeposit: monthlyDep,
            maximumOccupants: Number(rentRates.maxOccupants) || 2,
            status: 'vacant',
          });
        });
      });

      if (mappedBuildings.length === 0 || mappedRooms.length === 0) {
        throw new Error('กรุณาระบุข้อมูลอาคารและห้องพักอย่างน้อย 1 ห้อง');
      }

      // Preflight dorm-wide duplicate room check
      const seenFinalizeRooms = new Set<string>();
      for (const room of mappedRooms) {
        const norm = normalizeRoomIdentifier(room.roomNumber);
        if (seenFinalizeRooms.has(norm)) {
          throw new Error(`เลขห้อง "${room.roomNumber}" ซ้ำกับอาคารอื่น กรุณาเปลี่ยนเลขห้องหรือเลือกรูปแบบเลขห้องอื่น`);
        }
        seenFinalizeRooms.add(norm);
      }

      const waterBillingType = mapRegisterUtilityMode(formData.utilities.waterBillingMode);
      const elecBillingType = mapRegisterUtilityMode(formData.utilities.electricBillingMode);

      const isCustomizedWater = Boolean(
        formData.utilities.waterTierRates &&
        JSON.stringify(formData.utilities.waterTierRates) !== JSON.stringify(WATER_TIER_PRESET)
      );

      const isCustomizedElec = Boolean(
        formData.utilities.electricityTierRates &&
        JSON.stringify(formData.utilities.electricityTierRates) !== JSON.stringify(ELECTRICITY_TIER_PRESET)
      );

      const rawWaterTiers = formData.utilities.waterBillingMode === 'tiered'
        ? (formData.utilities.waterTierRates || WATER_TIER_PRESET)
        : (isCustomizedWater ? formData.utilities.waterTierRates : null);

      const rawElecTiers = formData.utilities.electricBillingMode === 'tiered'
        ? (formData.utilities.electricityTierRates || ELECTRICITY_TIER_PRESET)
        : (isCustomizedElec ? formData.utilities.electricityTierRates : null);

      const waterTierRates = rawWaterTiers ? normalizeCanonicalTiers(rawWaterTiers) : null;
      const electricityTierRates = rawElecTiers ? normalizeCanonicalTiers(rawElecTiers) : null;

      const rawPP = formData.paymentAccount.promptPayId ? formData.paymentAccount.promptPayId.replace(/\D/g, '') : null;
      const ppType = rawPP ? (rawPP.length === 13 ? 'national_id' : 'mobile_phone') : null;

      // Ensure quote is refreshed for current provDormId
      const quote = await onboardingClient.getSubscriptionQuote({
        isFreePlan: selectedPlan === 'free',
        packageId: selectedPlan === 'pro' ? (selectedPackageId || undefined) : undefined,
        promoCode: appliedPromo && validatedPromoCode ? validatedPromoCode : undefined,
        referralCode: isReferralBound && referralCodeInput ? referralCodeInput.trim() : undefined,
        coinRequested: coinToApply,
        dormitoryId: provDormId,
      });
      const activeIntentId = quote?.data?.intentId || quote?.intentId;
      const intentDormId = quote?.data?.dormitoryId || quote?.dormitoryId;

      if (!activeIntentId || (intentDormId && intentDormId !== provDormId)) {
        throw new Error('รายการคำสั่งซื้อไม่ตรงกับหอพักที่กำลังสร้าง กรุณาลองใหม่อีกครั้ง');
      }

      const payload = {
        provisionalDormitoryId: provDormId,
        dormitory: {
          name: formData.dormName,
          type: formData.dormType || 'apartment',
          genderPolicy: formData.genderType || 'รวม',
          addressLine1: formData.dormAddress || null,
          province: formData.province || null,
          phone: null,
          email: null,
          estimatedBuildingCount: mappedBuildings.length,
          estimatedRoomCount: mappedRooms.length,
        },
        billing: {
          dueDay: Number(formData.deposits.dueDateDay),
          waterBillingType,
          waterRate: String(formData.utilities.waterRate ?? 0),
          waterTierRates: waterTierRates || null,
          electricityBillingType: elecBillingType,
          electricityRate: String(formData.utilities.electricRate ?? 0),
          electricityTierRates: electricityTierRates || null,
          commonFee: String(formData.utilities.commonFeeRate ?? 0),
          commonFeeMode: formData.utilities.commonFeeMode || 'none',
          internetFee: String(formData.utilities.internetRate ?? 0),
          internetFeeMode: formData.utilities.internetFeeMode || 'none',
          parkingRate: String(formData.utilities.parkingFeeRate ?? 0),
          parkingFeeMode: formData.utilities.parkingFeeMode || 'none',
          gracePeriodDays: formData.deposits.gracePeriodDays || 0,
          advanceRentMonths: formData.deposits.advanceRentMonths || 1,
          lateFeeType: formData.deposits.lateFeeType || 'none',
          lateFeeValue: String(formData.deposits.lateFeeAmount ?? 0),
          rentBillingType: 'monthly',
        },
        payment: {
          cashAccepted: true,
          promptPayType: ppType,
          promptPayValue: rawPP,
          promptPayAccountName: formData.paymentAccount.promptPayName || null,
          bankCode: formData.paymentAccount.bankName || null,
          bankAccountName: formData.paymentAccount.bankAccountName || null,
          bankAccountNumber: formData.paymentAccount.accountNumber ? formData.paymentAccount.accountNumber.replace(/\D/g, '') : null,
        },
        buildings: mappedBuildings,
        rooms: mappedRooms,
        planCode: (selectedPlan || 'free').toUpperCase(),
        packageId: selectedPlan === 'pro' ? (selectedPackageId || undefined) : undefined,
        packageIntentId: activeIntentId,
        promoCode: appliedPromo && validatedPromoCode ? validatedPromoCode : undefined,
        referralCode: isReferralBound && referralCodeInput ? referralCodeInput.trim() : undefined,
        coinApplied: coinToApply > 0 ? coinToApply : undefined,
        petPolicy: {
          allowed: formData.petPolicy.allowed || 'none',
          allowedTypes: formData.petPolicy.allowedTypes || [],
        },
        defaultTerms: formData.rulesTemplate || undefined,
      };

      const finalizeRes = await onboardingClient.finalize(payload as any);
      const finalizedDormitoryId = finalizeRes?.data?.dormitory?.id || (finalizeRes?.data as any)?.dormitoryId || provDormId;
      if (finalizedDormitoryId) {
        localStorage.setItem('selected_dormitory_id', finalizedDormitoryId);
        sessionStorage.setItem('active_dormitory_selected_for_session', finalizedDormitoryId);
      }

      setShowTermsModal(false);
      setSaveProgress(0);
      setIsSavedSuccess(true);
      setTimeout(() => setSaveProgress(100), 50);

      // Scroll to top immediately when showing completion screen
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const scrollables = document.querySelectorAll('.overflow-y-auto, #owner-main-content');
      scrollables.forEach(el => { el.scrollTop = 0; });

      if (onAddLog) {
        onAddLog('บันทึกการลงทะเบียนหอพักและยอมรับเงื่อนไขเรียบร้อยแล้ว', 'system', 'onboarding');
      }

      // Clear local registration draft upon successful completion
      await clearRegistrationDraft(userId, mode || 'initial');

      setTimeout(() => {
        setIsSavedSuccess(false);
        setSaveProgress(0);
        window.location.href = '/owner/dashboard';
      }, 2800);
    } catch (e: any) {
      setValidationError(e?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
  };

  const REFERRAL_OPTIONS = [
    { id: 'facebook', label: 'Facebook / โซเชียล', icon: Share2 },
    { id: 'google', label: 'Google Search / เว็บ', icon: Search },
    { id: 'friend', label: 'เพื่อน / ช่างแนะนำ', icon: Users },
    { id: 'tiktok_youtube', label: 'TikTok / YouTube', icon: Video },
    { id: 'banner_event', label: 'ป้ายประกาศ / สัมมนา', icon: Megaphone },
    { id: 'other', label: 'ช่องทางอื่นๆ', icon: MessageSquare }
  ];

  const stepsList = [
    { num: 1, title: 'ข้อมูลหอพัก', sub: 'ชื่อ & ที่อยู่' },
    { num: 2, title: 'อาคาร & ผังห้อง', sub: 'ตึก & เลขห้อง' },
    { num: 3, title: 'ค่าเช่า & ค่าน้ำไฟ', sub: 'อัตราบริการ' },
    { num: 4, title: 'มัดจำ & บัญชี', sub: 'ประกัน & ธนาคาร' },
    { num: 5, title: 'กฎ & สัญญา', sub: 'ระเบียบ & ลายเซ็น' },
    { num: 6, title: 'เชื่อมต่อ LINE OA', sub: 'Channel ID & Secret' },
    { num: 7, title: 'เลือกแพ็กเกจ', sub: 'แพ็กเกจ & ยืนยัน' }
  ];

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto space-y-6 pb-20">
      {/* Full-Screen Success Overlay (Transparent Backdrop & Minimal Icon + Text) */}
      {isSavedSuccess && typeof document !== 'undefined' && createPortal(
        <div
          data-testid="registration-success-overlay"
          className="fixed inset-0 w-screen h-screen min-h-screen z-[9999] bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-200 pointer-events-auto"
        >
          <div className="flex flex-col items-center justify-center text-center space-y-3.5 max-w-sm w-full animate-in zoom-in-90 duration-300">
            {/* Animated Checkmark Circle */}
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping max-w-[80px] mx-auto h-20 w-20" />
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-tr from-emerald-500 to-teal-400 text-white rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/50 relative z-10 animate-in zoom-in-50 duration-300">
                <CheckCircle2 className="w-12 h-12 sm:w-14 sm:h-14 stroke-[2.5]" />
              </div>
            </div>

            {/* Concise Text Message */}
            <div className="space-y-1">
              <h3 className="text-2xl sm:text-3xl font-black text-white drop-shadow-md tracking-tight">
                ลงทะเบียนสำเร็จ!
              </h3>
              <p className="text-xs sm:text-sm font-extrabold text-emerald-200 drop-shadow-xs">
                บันทึกข้อมูลและยินยอมรับเงื่อนไขเรียบร้อยแล้ว
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Step Navigation Bar */}
      <div className="bg-white p-3 sm:p-4 rounded-3xl border border-slate-100 shadow-xs overflow-x-auto no-scrollbar">
        <div className="flex items-center justify-between min-w-[620px] sm:min-w-0 px-1 gap-1.5">
          {stepsList.map((st) => {
            const isActive = currentStep === st.num;
            const isDone = currentStep > st.num;
            return (
              <React.Fragment key={st.num}>
                <button
                  onClick={() => handleStepClick(st.num)}
                  className="flex items-center gap-2 text-left group cursor-pointer whitespace-nowrap shrink-0"
                >
                  <div
                    className={`w-8 h-8 sm:w-9 sm:h-9 rounded-2xl flex items-center justify-center font-black text-xs transition-all shadow-2xs shrink-0 ${isActive
                      ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                      : isDone
                        ? 'bg-emerald-500 text-white'
                        : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                      }`}
                  >
                    {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : st.num}
                  </div>
                  <div>
                    <h5 className={`text-xs font-black leading-tight ${isActive ? 'text-blue-600' : isDone ? 'text-slate-800' : 'text-slate-400'}`}>
                      {st.title}
                    </h5>
                    <p className="text-[10px] text-slate-400 font-medium hidden md:block">{st.sub}</p>
                  </div>
                </button>

                {st.num < stepsList.length && (
                  <div className={`h-0.5 flex-1 min-w-[8px] mx-1 rounded-full ${currentStep > st.num ? 'bg-emerald-500' : 'bg-slate-100'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* STEP 1: Dormitory Info */}
      {currentStep === 1 && (
        <div className="bg-white p-5 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Building2 className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 1: ข้อมูลหอพัก</h3>
              <p className="text-xs text-slate-400 font-medium">ระบุชื่อหอพัก ที่อยู่ และข้อมูลพื้นฐานของหอพัก</p>
            </div>
          </div>

          <div className="bg-slate-50/60 p-5 sm:p-6 rounded-2xl border border-slate-100 space-y-4">

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อหอพัก / อพาร์ตเมนต์ <span className="text-rose-500">*</span></label>
              <input
                type="text"
                value={formData.dormName}
                onChange={(e) => setFormData({ ...formData, dormName: e.target.value })}
                placeholder="เช่น หอพัก HorPlus สุขุมวิท"
                className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800"
              />
            </div>

            <DormitoryLogoUploader
              provisionalDormitoryId={provisionalDormitoryId}
              ensureProvisionalDormitoryId={ensureProvisionalDormitoryId}
              logoUrl={formData.logoUrl || null}
              onLogoChange={(newLogoUrl) => {
                setFormData((prev: any) => ({
                  ...prev,
                  logoUrl: newLogoUrl,
                  hasLogo: Boolean(newLogoUrl),
                }));
              }}
              onError={(err) => setValidationError(err)}
            />

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ที่อยู่หอพัก (สำหรับออกเอกสารสัญญา) <span className="text-rose-500">*</span></label>
              <textarea
                rows={3}
                value={formData.dormAddress}
                onChange={(e) => setFormData({ ...formData, dormAddress: e.target.value })}
                placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"
                className="w-full p-3 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-medium sm:font-bold text-slate-800 leading-relaxed min-h-[84px] resize-y"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">จังหวัด <span className="text-rose-500">*</span></label>
                <select
                  value={formData.province || 'กรุงเทพมหานคร'}
                  onChange={(e) => setFormData({ ...formData, province: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800 cursor-pointer"
                >
                  {PROVINCE_OPTIONS.map((prov) => (
                    <option key={prov} value={prov}>{prov}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ประเภทที่พัก <span className="text-rose-500">*</span></label>
                <select
                  value={formData.dormType || 'อพาร์ตเมนต์'}
                  onChange={(e) => setFormData({ ...formData, dormType: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800 cursor-pointer"
                >
                  {DORM_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Gender Policy Selector (ชาย, หญิง, รวม) */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">ประเภทผู้พัก / เพศของหอพัก <span className="text-rose-500">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                {GENDER_TYPE_OPTIONS.map((g) => {
                  const isSelected = (formData.genderType || 'รวม') === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, genderType: g.id })}
                      className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center ${isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                        }`}
                    >
                      <span className="text-xs font-black">{g.label}</span>
                      <span className={`text-[9px] mt-0.5 ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>{g.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* STEP 2: Flexible Building Structure & Rooms (Enhanced per User Request) */}
      {currentStep === 2 && (
        <div className="bg-white p-5 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              <div>
                <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 2: อาคาร & ผังห้อง</h3>
                <p className="text-xs text-slate-400 font-medium">ตั้งค่ารูปแบบเลขห้องพักได้อย่างยืดหยุ่น เช่น A101, 101, A1/1 หรือระบุเอง</p>
              </div>
            </div>
            <button
              onClick={handleAddBuilding}
              data-testid="btn-add-building"
              className="px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-2xl text-xs font-extrabold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              เพิ่มอาคารใหม่
            </button>
          </div>

          {/* Total Room Counter Indicator (Hard limit 150) */}
          {(() => {
            const totalRoomsCount = formData.buildings.reduce((sum, b) => sum + getGeneratedRooms(b).length, 0);
            const isOverLimit = totalRoomsCount > 150;
            return (
              <div
                data-testid="step2-total-rooms-indicator"
                className={`p-3.5 rounded-2xl border flex items-center justify-between flex-wrap gap-2 ${isOverLimit ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-blue-50/70 border-blue-100 text-blue-900'
                  }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className={`w-4 h-4 ${isOverLimit ? 'text-rose-600' : 'text-blue-600'}`} />
                  <span className="text-xs font-black">
                    รวมห้องพักทุกอาคาร: {totalRoomsCount} / 150 ห้อง
                  </span>
                </div>
                {isOverLimit ? (
                  <span className="text-xs font-black text-rose-600 animate-pulse">
                    ⚠️ หนึ่งหอพักสามารถสร้างห้องได้สูงสุด 150 ห้อง (เกินขีดจำกัด)
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-blue-600">
                    (สร้างห้องได้สูงสุด 150 ห้องต่อหอพัก)
                  </span>
                )}
              </div>
            );
          })()}

          <div className="space-y-6">
            {formData.buildings.map((b, idx) => {
              const currentRoomList = getGeneratedRooms(b);

              return (
                <div key={b.id} className="bg-slate-50/70 p-4 sm:p-6 rounded-3xl border border-slate-200/80 space-y-5 relative">
                  {/* Building Header Bar */}
                  <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200/60">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-blue-700 bg-blue-50 border border-blue-100 px-3.5 py-1.5 rounded-xl text-sm flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-blue-600" />
                        {(b.name && b.name.trim()) ? formatBuildingDisplayName(b.name) : (b.roomPrefix ? `อาคาร ${b.roomPrefix}` : 'อาคาร')}
                      </span>
                    </div>

                    {/* Auto / Manual Mode Switcher */}
                    <div className="flex items-center gap-2">
                      <div className="bg-white p-1 rounded-2xl border border-slate-200/80 flex items-center gap-1 shadow-3xs">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...formData.buildings];
                            updated[idx].mode = 'auto';
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 cursor-pointer ${b.mode === 'auto'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          สร้างอัตโนมัติ
                        </button>
                        <button
                          type="button"
                          data-testid={`btn-building-manual-mode-${idx}`}
                          onClick={() => {
                            const updated = [...formData.buildings];
                            updated[idx].mode = 'manual';
                            setFormData({ ...formData, buildings: updated });
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 cursor-pointer ${b.mode === 'manual'
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          เขียนเลขห้องเอง
                        </button>
                      </div>

                      {formData.buildings.length > 1 && (
                        <button
                          onClick={() => handleRemoveBuilding(b.id)}
                          className="text-slate-400 hover:text-rose-600 p-2 rounded-xl hover:bg-rose-50 transition-colors cursor-pointer"
                          title="ลบอาคารนี้"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* AUTO GENERATE MODE */}
                  {b.mode === 'auto' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">ชื่ออาคาร</label>
                          <input
                            type="text"
                            value={b.name || ''}
                            onChange={(e) => {
                              const updated = [...formData.buildings];
                              updated[idx].name = e.target.value;
                              setFormData({ ...formData, buildings: updated });
                            }}
                            placeholder="เช่น สมบูรณ์, อาคาร A"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">จำนวนชั้น (ชั้น)</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={b.totalFloors}
                            onChange={(e) => {
                              const val = normalizeNumericInput(e.target.value, false);
                              const updated = [...formData.buildings];
                              updated[idx].totalFloors = val;
                              setFormData({ ...formData, buildings: updated });
                            }}
                            placeholder="ระบุจำนวนชั้น"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">ห้องต่อชั้น (ห้อง)</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={b.roomsPerFloor}
                            onChange={(e) => {
                              const val = normalizeNumericInput(e.target.value, false);
                              const updated = [...formData.buildings];
                              updated[idx].roomsPerFloor = val;
                              setFormData({ ...formData, buildings: updated });
                            }}
                            placeholder="ระบุห้องต่อชั้น"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">จำนวนผู้เข้าพักสูงสุด (คน)</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={b.rentRates?.maxOccupants ?? 2}
                            onChange={(e) => {
                              const norm = normalizeNumericInput(e.target.value, false);
                              const updated = [...formData.buildings];
                              updated[idx].rentRates = {
                                ...(updated[idx].rentRates || {
                                  monthly: 0,
                                  term: 0,
                                  termMonths: 4,
                                  maxInstallmentMonths: 2,
                                  daily: 0,
                                  maxOccupants: 2
                                }),
                                maxOccupants: norm
                              };
                              setFormData({ ...formData, buildings: updated });
                            }}
                            placeholder="2"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">รูปแบบเลขห้อง</label>
                          {(() => {
                            const pfx = (b.name && b.name.trim()) ? b.name.trim() : (b.roomPrefix ? b.roomPrefix.trim() : 'A');
                            return (
                              <select
                                value={b.formatPattern || 'prefix_floor_room'}
                                onChange={(e) => {
                                  const updated = [...formData.buildings];
                                  updated[idx].formatPattern = e.target.value;
                                  setFormData({ ...formData, buildings: updated });
                                }}
                                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-extrabold text-blue-700"
                              >
                                <option value="prefix_floor_room">ตึกชั้นห้อง ({pfx}101)</option>
                                <option value="floor_room">ชั้นห้องแบบไม่มีตึก (101)</option>
                                <option value="prefix_floor_slash_room">ตึกชั้น/ห้อง ({pfx}1/1)</option>
                                <option value="floor_slash_room">ชั้น/ห้อง (1/1)</option>
                                <option value="prefix_dash_floor_room">ตึก-ชั้นห้อง ({pfx}-101)</option>
                              </select>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* MANUAL ROOM ENTRY MODE */}
                  {b.mode === 'manual' && (
                    <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200/80">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-2 border-b border-slate-100">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">ชื่ออาคาร</label>
                          <input
                            type="text"
                            value={b.name || ''}
                            onChange={(e) => {
                              const updated = [...formData.buildings];
                              updated[idx].name = e.target.value;
                              setFormData({ ...formData, buildings: updated });
                            }}
                            placeholder="เช่น อาคาร A"
                            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-bold text-slate-800"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">จำนวนผู้เข้าพักสูงสุด (คน)</label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={b.rentRates?.maxOccupants ?? 2}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              const updated = [...formData.buildings];
                              updated[idx].rentRates = {
                                ...(updated[idx].rentRates || {
                                  monthly: 0,
                                  term: 0,
                                  termMonths: 4,
                                  maxInstallmentMonths: 2,
                                  daily: 0,
                                  maxOccupants: 2
                                }),
                                maxOccupants: isNaN(val) ? 1 : Math.max(1, val)
                              };
                              setFormData({ ...formData, buildings: updated });
                            }}
                            placeholder="2"
                            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-bold text-slate-800"
                          />
                        </div>
                      </div>

                      <label className="block text-xs font-black text-slate-800">
                        กรอกเลขห้องพักเอง (คั่นด้วยเครื่องหมายจุลภาค , หรือเว้นวรรค)
                      </label>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          type="text"
                          value={manualInputs[b.id] || ''}
                          onChange={(e) => setManualInputs({ ...manualInputs, [b.id]: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddManualRooms(idx);
                            }
                          }}
                          placeholder="เช่น A101, A102, A1/1, 101, 102"
                          className="w-full sm:flex-1 px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-blue-500 outline-none font-bold text-slate-800"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddManualRooms(idx)}
                          className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer shadow-xs shrink-0 flex items-center justify-center gap-1"
                        >
                          <span>+ เพิ่มเลขห้อง</span>
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 font-medium">
                        พิมพ์เลขห้องแล้วกด เพิ่มเลขห้อง หรือกด Enter เพื่อใส่เลขห้องในตึกนี้
                      </p>
                    </div>
                  )}

                  {/* ROOM PILLS GRID DISPLAY (Matches Screenshot Style with Direct Click Edit) */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-200/80 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-black text-slate-700 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-blue-600" />
                        รายการเลขห้องพักในตึกนี้ ({currentRoomList.length} ห้อง)
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenBulkEdit(idx)}
                          className="text-[11px] font-extrabold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2.5 py-1 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                          title="แก้ไขเลขห้องทั้งหมดในคราวเดียว"
                        >
                          <Edit3 className="w-3 h-3 text-blue-600" />
                          แก้ไขเลขห้องทั้งหมด
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetBuildingRooms(idx)}
                          className="text-[11px] font-extrabold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-2.5 py-1 rounded-xl transition-all cursor-pointer flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          รีเซ็ต
                        </button>
                      </div>
                    </div>

                    {/* Bulk Room Editor Mode */}
                    {bulkEditingBuildingIdx === idx && (
                      <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-black text-blue-900 flex items-center gap-1.5">
                            <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                            แก้ไขชื่อ/เลขห้องทั้งหมดในตึกนี้ (คั่นด้วยเครื่องหมายจุลภาค , หรือเว้นวรรค)
                          </label>
                          <span className="text-[10px] text-blue-600 font-bold">พิมพ์หรือปรับเปลี่ยนชื่อห้องได้ฟรีสไตล์</span>
                        </div>
                        <textarea
                          rows={3}
                          value={bulkRoomsInputText}
                          onChange={(e) => setBulkRoomsInputText(e.target.value)}
                          placeholder="เช่น A101, A102, A103-Suite, A104-VIP"
                          className="w-full p-2.5 bg-white border border-blue-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:border-blue-500 outline-none leading-relaxed"
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setBulkEditingBuildingIdx(null)}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveBulkEdit(idx)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            บันทึกรายการเลขห้อง
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="max-h-56 overflow-y-auto p-2 bg-slate-50/50 rounded-xl border border-slate-200/60">
                      <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {currentRoomList.map((rm) => {
                          const isEditingThis = editingRoom?.bIdx === idx && editingRoom?.oldRoom === rm;

                          if (isEditingThis) {
                            return (
                              <div
                                key={rm}
                                className="bg-blue-50 p-1.5 rounded-xl border border-blue-400 flex items-center justify-between text-xs font-bold shadow-xs col-span-1 sm:col-span-2"
                              >
                                <input
                                  type="text"
                                  value={editingRoom.newRoom}
                                  onChange={(e) => setEditingRoom({ ...editingRoom, newRoom: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveSingleRoomEdit();
                                    } else if (e.key === 'Escape') {
                                      setEditingRoom(null);
                                    }
                                  }}
                                  autoFocus
                                  className="w-full px-2 py-1 bg-white border border-blue-300 rounded-lg text-xs font-black text-blue-900 outline-none"
                                />
                                <div className="flex items-center gap-1 ml-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={handleSaveSingleRoomEdit}
                                    className="p-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer"
                                    title="บันทึก"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingRoom(null)}
                                    className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-colors cursor-pointer"
                                    title="ยกเลิก"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={rm}
                              className="bg-white pl-2.5 pr-1 py-1 rounded-xl border border-slate-200 flex items-center justify-between text-xs font-black text-blue-900 shadow-3xs group hover:border-blue-300 transition-colors"
                            >
                              <button
                                type="button"
                                onClick={() => setEditingRoom({ bIdx: idx, oldRoom: rm, newRoom: rm })}
                                className="flex items-center gap-1.5 min-w-0 flex-1 text-left py-1 text-blue-950 hover:text-blue-600 transition-colors cursor-pointer"
                                title={`คลิกเพื่อแก้ไขเลขห้อง ${rm}`}
                              >
                                <Building2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 shrink-0" />
                                <span className="font-extrabold text-xs text-slate-800 group-hover:text-blue-700 truncate">{rm}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveSingleRoom(idx, rm);
                                }}
                                className="text-slate-300 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                                title={`ลบห้อง ${rm}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}

                        {currentRoomList.length === 0 && (
                          <div className="col-span-full text-center py-6 text-xs text-slate-400 font-bold">
                            ยังไม่มีห้องพักในตึกนี้ กรุณาเลือกสร้างอัตโนมัติหรือกรอกเลขห้องเอง
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 3: Rates & Utilities (Mirrors Settings Page & Building-specific Rent) */}
      {currentStep === 3 && (
        <div className="bg-white p-5 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <CreditCard className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ</h3>
              <p className="text-xs text-slate-400 font-medium">ตั้งค่ารูปแบบค่าน้ำไฟส่วนกลาง (อ้างอิงจากหน้าตั้งค่า) และปรับอัตราค่าเช่าแยกตามแต่ละตึก</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Utilities Section (Matching Settings Page Structure) */}
            <div className="bg-slate-50/70 p-4 sm:p-5 rounded-3xl border border-slate-200/80 space-y-4">
              <h4 className="text-xs font-black text-indigo-950 uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                อัตราค่าน้ำ ค่าไฟฟ้า และค่าบริการอื่นๆ
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                {/* Water */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2">
                  <label className="block font-black text-slate-800 flex items-center gap-1.5">
                    <Droplet className="w-4 h-4 text-blue-500" /> ค่าน้ำ
                  </label>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">อัตรา (บาท)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid="input-register-water-rate"
                      disabled={formData.utilities.waterBillingMode === 'tiered'}
                      value={formData.utilities.waterBillingMode === 'tiered' ? 'คิดตามขั้นบันได' : formData.utilities.waterRate}
                      onChange={(e) => {
                        const norm = normalizeNumericInput(e.target.value, true);
                        setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, waterRate: norm } }));
                      }}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-800 outline-none disabled:opacity-75 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">รูปแบบการคิด</span>
                    <select
                      data-testid="select-register-water-mode"
                      value={formData.utilities.waterBillingMode}
                      onChange={(e) => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, waterBillingMode: e.target.value } }))}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none cursor-pointer"
                    >
                      <option value="unit">บาท/หน่วย</option>
                      <option value="person">บาท/คน</option>
                      <option value="room">บาท/ห้อง</option>
                      <option value="tiered">คิดตามขั้นบันได</option>
                    </select>
                  </div>
                </div>

                {/* Electric */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2">
                  <label className="block font-black text-slate-800 flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-amber-500" /> ค่าไฟฟ้า
                  </label>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">อัตรา (บาท)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      data-testid="input-register-electric-rate"
                      disabled={formData.utilities.electricBillingMode === 'tiered'}
                      value={formData.utilities.electricBillingMode === 'tiered' ? 'คิดตามขั้นบันได' : formData.utilities.electricRate}
                      onChange={(e) => {
                        const norm = normalizeNumericInput(e.target.value, true);
                        setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, electricRate: norm } }));
                      }}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-800 outline-none disabled:opacity-75 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">รูปแบบการคิด</span>
                    <select
                      data-testid="select-register-electric-mode"
                      value={formData.utilities.electricBillingMode}
                      onChange={(e) => setFormData(prev => ({ ...prev, utilities: { ...prev.utilities, electricBillingMode: e.target.value } }))}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none cursor-pointer"
                    >
                      <option value="unit">บาท/หน่วย</option>
                      <option value="person">บาท/คน</option>
                      <option value="room">บาท/ห้อง</option>
                      <option value="tiered">คิดตามขั้นบันได</option>
                    </select>
                  </div>
                </div>

                {/* Common Fee */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2">
                  <label className="block font-black text-slate-800 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-emerald-500" /> ค่าส่วนกลาง
                  </label>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">อัตรา (บาท)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formData.utilities.commonFeeMode === 'free' || formData.utilities.commonFeeMode === 'none' ? 0 : formData.utilities.commonFeeRate}
                      disabled={formData.utilities.commonFeeMode === 'free' || formData.utilities.commonFeeMode === 'none'}
                      onChange={(e) => {
                        const norm = normalizeNumericInput(e.target.value, true);
                        setFormData({ ...formData, utilities: { ...formData.utilities, commonFeeRate: norm } });
                      }}
                      placeholder={formData.utilities.commonFeeMode === 'free' || formData.utilities.commonFeeMode === 'none' ? 'ฟรี' : '0'}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-800 outline-none disabled:opacity-50 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">รูปแบบการคิด</span>
                    <select
                      value={formData.utilities.commonFeeMode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        setFormData({
                          ...formData,
                          utilities: {
                            ...formData.utilities,
                            commonFeeMode: mode,
                            commonFeeRate: mode === 'free' || mode === 'none' ? 0 : (formData.utilities.commonFeeRate || 0)
                          }
                        });
                      }}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none cursor-pointer"
                    >
                      <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                      <option value="room">บาท/ห้อง</option>
                      <option value="person">บาท/คน</option>
                    </select>
                  </div>
                </div>

                {/* Internet */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2">
                  <label className="block font-black text-slate-800 flex items-center gap-1.5">
                    <Wifi className="w-4 h-4 text-indigo-500" /> ค่าอินเทอร์เน็ต
                  </label>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">อัตรา (บาท)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formData.utilities.internetFeeMode === 'free' || formData.utilities.internetFeeMode === 'none' ? 0 : formData.utilities.internetRate}
                      disabled={formData.utilities.internetFeeMode === 'free' || formData.utilities.internetFeeMode === 'none'}
                      onChange={(e) => {
                        const norm = normalizeNumericInput(e.target.value, true);
                        setFormData({ ...formData, utilities: { ...formData.utilities, internetRate: norm } });
                      }}
                      placeholder={formData.utilities.internetFeeMode === 'free' || formData.utilities.internetFeeMode === 'none' ? 'ฟรี' : '0'}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-800 outline-none disabled:opacity-50 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">รูปแบบการคิด</span>
                    <select
                      value={formData.utilities.internetFeeMode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        setFormData({
                          ...formData,
                          utilities: {
                            ...formData.utilities,
                            internetFeeMode: mode,
                            internetRate: mode === 'free' || mode === 'none' ? 0 : (formData.utilities.internetRate || 0)
                          }
                        });
                      }}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none cursor-pointer"
                    >
                      <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                      <option value="room">บาท/ห้อง</option>
                      <option value="person">บาท/คน</option>
                    </select>
                  </div>
                </div>

                {/* Parking Fee */}
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 space-y-2">
                  <label className="block font-black text-slate-800 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-purple-500" /> ค่าจอดรถ
                  </label>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">อัตรา (บาท)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formData.utilities.parkingFeeMode === 'free' ? 0 : formData.utilities.parkingFeeRate}
                      disabled={formData.utilities.parkingFeeMode === 'free'}
                      onChange={(e) => {
                        const norm = normalizeNumericInput(e.target.value, true);
                        setFormData({ ...formData, utilities: { ...formData.utilities, parkingFeeRate: norm } });
                      }}
                      placeholder={formData.utilities.parkingFeeMode === 'free' ? 'ฟรี' : '0'}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-slate-800 outline-none disabled:opacity-50 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold block mb-1">รูปแบบการคิด</span>
                    <select
                      value={formData.utilities.parkingFeeMode}
                      onChange={(e) => {
                        const mode = e.target.value as 'room' | 'free' | 'vehicle';
                        setFormData({
                          ...formData,
                          utilities: {
                            ...formData.utilities,
                            parkingFeeMode: mode,
                            parkingFeeRate: mode === 'free' ? 0 : (formData.utilities.parkingFeeRate || 0)
                          }
                        });
                      }}
                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none cursor-pointer"
                    >
                      <option value="free">ไม่คิดค่าบริการ (ฟรี)</option>
                      <option value="room">บาท/ห้อง</option>
                      <option value="vehicle">บาท/คัน</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Responsive Tiered Rates Editors */}
              {(formData.utilities.waterBillingMode === 'tiered' || formData.utilities.electricBillingMode === 'tiered') && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
                  {formData.utilities.waterBillingMode === 'tiered' && (
                    <div className="space-y-1">
                      <TieredRateEditor
                        utilityType="water"
                        tiers={formData.utilities.waterTierRates || WATER_TIER_PRESET}
                        onChange={(tiers) => {
                          setFormData(prev => ({
                            ...prev,
                            utilities: {
                              ...prev.utilities,
                              waterTierRates: tiers,
                            }
                          }));
                        }}
                      />
                    </div>
                  )}

                  {formData.utilities.electricBillingMode === 'tiered' && (
                    <div className="space-y-1">
                      <TieredRateEditor
                        utilityType="electricity"
                        tiers={formData.utilities.electricityTierRates || ELECTRICITY_TIER_PRESET}
                        onChange={(tiers) => {
                          setFormData(prev => ({
                            ...prev,
                            utilities: {
                              ...prev.utilities,
                              electricityTierRates: tiers,
                            }
                          }));
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Rent Rates Per Building (Adjustable per building per user request) */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <BuildingIcon className="w-4 h-4 text-blue-600" />
                ตั้งค่าอัตราค่าเช่าแยกตามแต่ละตึก
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {formData.buildings.map((b, bIdx) => {
                  const rentRates = b.rentRates || {
                    monthly: 0,
                    term: 0,
                    termMonths: 4,
                    maxInstallmentMonths: 2,
                    daily: 0,
                    maxOccupants: 2
                  };

                  return (
                    <div key={b.id} className="bg-slate-50/70 p-4 sm:p-5 rounded-3xl border border-slate-200/80 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="text-xs font-black text-blue-700 bg-blue-50 px-3 py-1 rounded-xl border border-blue-100 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-blue-600" />
                          {b.name}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400">
                          {getGeneratedRooms(b).length} ห้องพัก
                        </span>
                      </div>

                      <div className="space-y-3">
                        {/* Monthly Rent and Daily Rent */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">ค่าเช่ารายเดือน (บาท/เดือน)</label>
                            <input
                              type="text"
                              data-testid={`input-building-monthly-rent-${bIdx}`}
                              inputMode="decimal"
                              value={rentRates.monthly}
                              onChange={(e) => {
                                const norm = normalizeNumericInput(e.target.value, true);
                                setFormData(prev => ({
                                  ...prev,
                                  buildings: prev.buildings.map((bldg, idx) =>
                                    idx === bIdx
                                      ? { ...bldg, rentRates: { ...(bldg.rentRates || {}), monthly: norm } }
                                      : bldg
                                  )
                                }));
                              }}
                              className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl font-black text-slate-800 outline-none focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">ค่าเช่ารายวัน (บาท/วัน)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={rentRates.daily}
                              onChange={(e) => {
                                const norm = normalizeNumericInput(e.target.value, true);
                                setFormData(prev => ({
                                  ...prev,
                                  buildings: prev.buildings.map((bldg, idx) =>
                                    idx === bIdx
                                      ? { ...bldg, rentRates: { ...(bldg.rentRates || {}), daily: norm } }
                                      : bldg
                                  )
                                }));
                              }}
                              className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl font-black text-slate-800 outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>

                        <div className="p-3 bg-blue-50/50 rounded-2xl border border-blue-100/60 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-xs font-bold text-blue-900">ค่าเช่ารายเทอม (บาท/เทอม)</label>
                            <span className="text-[10px] bg-blue-600 text-white font-black px-2 py-0.5 rounded-md">รายเทอม</span>
                          </div>

                          {/* Term Price and Duration on the Same Line */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={rentRates.term}
                              onChange={(e) => {
                                const norm = normalizeNumericInput(e.target.value, true);
                                setFormData(prev => ({
                                  ...prev,
                                  buildings: prev.buildings.map((bldg, idx) =>
                                    idx === bIdx
                                      ? { ...bldg, rentRates: { ...(bldg.rentRates || {}), term: norm } }
                                      : bldg
                                  )
                                }));
                              }}
                              placeholder="18000"
                              className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl font-bold text-blue-700 outline-none focus:border-blue-500"
                            />
                            <div className="flex items-center gap-1 bg-white px-2.5 py-1.5 border border-slate-200 rounded-xl shrink-0">
                              <span className="text-xs font-bold text-slate-400">ระยะ:</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={rentRates.termMonths}
                                onChange={(e) => {
                                  const norm = normalizeNumericInput(e.target.value, false);
                                  setFormData(prev => ({
                                    ...prev,
                                    buildings: prev.buildings.map((bldg, idx) =>
                                      idx === bIdx
                                        ? { ...bldg, rentRates: { ...(bldg.rentRates || {}), termMonths: norm } }
                                        : bldg
                                    )
                                  }));
                                }}
                                className="w-8 text-xs font-black text-slate-800 outline-none text-center"
                              />
                              <span className="text-xs font-bold text-slate-400">เดือน</span>
                            </div>
                          </div>

                          {/* Compact Max Installment Row */}
                          <div className="pt-2 border-t border-blue-100/80 flex items-center justify-between gap-2">
                            <label className="text-xs font-bold text-blue-900 shrink-0">แบ่งชำระสูงสุด:</label>
                            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 border border-blue-200 rounded-xl">
                              <input
                                type="text"
                                inputMode="numeric"
                                value={rentRates.maxInstallmentMonths ?? 2}
                                onChange={(e) => {
                                  const norm = normalizeNumericInput(e.target.value, false);
                                  const updated = [...formData.buildings];
                                  updated[bIdx].rentRates = {
                                    ...rentRates,
                                    maxInstallmentMonths: norm
                                  };
                                  setFormData({ ...formData, buildings: updated });
                                }}
                                className="w-8 text-xs font-black text-blue-700 outline-none text-center"
                              />
                              <span className="text-xs font-bold text-slate-600">งวด</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: Deposit, Late Fee & Payment Account (Enhanced Bank Dropbox & Account Name Note) */}
      {currentStep === 4 && (
        <div className="bg-white p-5 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 4: มัดจำ & บัญชี</h3>
              <p className="text-xs text-slate-400 font-medium">กำหนดเงินประกันแรกเข้า วันครบกำหนดชำระ ค่าปรับ และระบุบัญชีธนาคารสำหรับตรวจสอบสลิปอัตโนมัติ</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Deposits & Late Fees */}
            <div className="bg-slate-50/60 p-4 sm:p-5 rounded-2xl border border-slate-100 space-y-4">
              <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                <AlertCircle className="w-4 h-4 text-amber-600" /> เงินมัดจำ / ประกัน & กฎการปรับ
              </h4>

              {/* Per-Building Security Deposits (Three rental modes) */}
              <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/90 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 gap-2">
                  <label className="block text-xs font-black text-slate-800 flex items-center gap-1.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>เงินประกันตามประเภทการเช่า (บาท) <span className="text-rose-500">*</span></span>
                  </label>
                  <span className="text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0">
                    ตั้งค่าตามตึก
                  </span>
                </div>

                <div className="space-y-3">
                  {formData.buildings.map((b, bIdx) => {
                    const bLabel = (b.name && b.name.trim()) ? formatBuildingDisplayName(b.name) : (b.roomPrefix ? `อาคาร ${b.roomPrefix}` : `อาคารที่ ${bIdx + 1}`);
                    const legacyDep = b.securityDeposit !== undefined ? b.securityDeposit : (formData.deposits.securityDeposit ?? 0);
                    const termVal = b.termDeposit !== undefined ? b.termDeposit : legacyDep;
                    const monthlyVal = b.monthlyDeposit !== undefined ? b.monthlyDeposit : legacyDep;
                    const dailyVal = b.dailyDeposit !== undefined ? b.dailyDeposit : legacyDep;

                    return (
                      <div key={b.id} className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/80 space-y-2" data-testid={`building-deposits-${bIdx}`}>
                        <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800 border-b border-slate-200/60 pb-1.5">
                          <Building2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          <span>{bLabel}</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                          {/* Term Deposit */}
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              ค่าประกันรายเทอม (บาท)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={termVal}
                              onChange={(e) => {
                                const norm = normalizeNumericInput(e.target.value, true);
                                const updated = [...formData.buildings];
                                updated[bIdx].termDeposit = norm;
                                setFormData({ ...formData, buildings: updated });
                              }}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-blue-500 outline-none font-black text-slate-800 text-right"
                              data-testid={`input-term-deposit-${bIdx}`}
                              placeholder="0"
                            />
                          </div>

                          {/* Monthly Deposit */}
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              ค่าประกันรายเดือน (บาท)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={monthlyVal}
                              onChange={(e) => {
                                const norm = normalizeNumericInput(e.target.value, true);
                                const updated = [...formData.buildings];
                                updated[bIdx].monthlyDeposit = norm;
                                updated[bIdx].securityDeposit = norm;
                                setFormData({ ...formData, buildings: updated });
                              }}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-blue-500 outline-none font-black text-slate-800 text-right"
                              data-testid={`input-monthly-deposit-${bIdx}`}
                              placeholder="0"
                            />
                          </div>

                          {/* Daily Deposit */}
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">
                              ค่าประกันรายวัน (บาท)
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={dailyVal}
                              onChange={(e) => {
                                const norm = normalizeNumericInput(e.target.value, true);
                                const updated = [...formData.buildings];
                                updated[bIdx].dailyDeposit = norm;
                                setFormData({ ...formData, buildings: updated });
                              }}
                              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-blue-500 outline-none font-black text-slate-800 text-right"
                              data-testid={`input-daily-deposit-${bIdx}`}
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/60">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  วันครบกำหนดชำระ (ของทุกเดือน) <span className="text-red-500">*</span>
                </label>
                <select
                  data-testid="due-date-select"
                  value={formData.deposits.dueDateDay || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({
                      ...formData,
                      deposits: {
                        ...formData.deposits,
                        dueDateDay: val === '' ? '' : parseInt(val, 10),
                      },
                    });
                  }}
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold"
                >
                  <option value="">-- กรุณาเลือกวันครบกำหนดชำระ --</option>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>ทุกวันที่ {d} ของเดือน</option>
                  ))}
                </select>
              </div>

              <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <label className="block text-xs font-black text-amber-950">อัตราค่าปรับเมื่อเกินวันกำหนดชำระ</label>
                  </div>
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0">
                    ค่าปรับ
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'none', label: 'ไม่มีค่าปรับ', desc: 'ไม่เรียกเก็บค่าปรับค้างชำระ' },
                    { id: 'per_day', label: 'ปรับคิดรายวัน', desc: 'คิดคำนวณตามจำนวนวันที่เลท (บาท/วัน)' },
                    { id: 'fixed_once', label: 'ปรับเหมาครั้งเดียว', desc: 'คิดอัตราเหมาจ่ายต่อใบแจ้งหนี้ (บาท/บิล)' }
                  ].map((opt) => {
                    const active = formData.deposits.lateFeeType === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            deposits: {
                              ...formData.deposits,
                              lateFeeType: opt.id,
                              lateFeeAmount: opt.id === 'none' ? 0 : (formData.deposits.lateFeeAmount || 100)
                            }
                          });
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${active
                          ? 'bg-amber-500/10 border-amber-500 text-amber-950 shadow-2xs ring-1 ring-amber-400'
                          : 'bg-white border-amber-200/70 text-slate-700 hover:border-amber-300 hover:bg-amber-50/40'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-xs font-black ${active ? 'text-amber-950' : 'text-slate-800'}`}>
                            {opt.label}
                          </span>
                          {active && <Check className="w-3.5 h-3.5 text-amber-700 stroke-[3] shrink-0" />}
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-tight">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>

                {formData.deposits.lateFeeType !== 'none' && (
                  <div className="pt-2 border-t border-amber-200/60 flex items-center gap-3 flex-wrap animate-in fade-in duration-200">
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={formData.deposits.lateFeeAmount || ''}
                        onChange={(e) => {
                          const norm = normalizeNumericInput(e.target.value, true);
                          setFormData({ ...formData, deposits: { ...formData.deposits, lateFeeAmount: norm } });
                        }}
                        placeholder="100"
                        className="w-full pl-3.5 pr-20 py-2 text-xs bg-white border border-amber-300 focus:border-amber-500 rounded-xl font-black text-amber-950 outline-none shadow-2xs"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-amber-800 pointer-events-none">
                        {formData.deposits.lateFeeType === 'per_day' ? 'บาท / วัน' : 'บาท / บิล'}
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-amber-800">
                      {formData.deposits.lateFeeType === 'per_day'
                        ? '*คิดตามจำนวนวันเมื่อเลยวันครบกำหนด'
                        : '*บวกเพิ่มในบิลรอบถัดไปทันที'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Payment Account with Separate Bank Account Name & PromptPay Account Name */}
            <div className="bg-slate-50/60 p-4 sm:p-5 rounded-2xl border border-slate-100 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
                <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
                  <CreditCard className="w-4 h-4 text-emerald-600" /> บัญชีรับชำระเงิน (ตรวจสลิป)
                </h4>
              </div>

              {/* Sub-section 1: Bank Account Details */}
              <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-2xs space-y-3.5">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                  <div className="w-5 h-5 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-black text-[11px]">
                    1
                  </div>
                  <h5 className="text-xs font-black text-slate-800">ข้อมูลบัญชีธนาคาร</h5>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      ธนาคารที่รับโอน <span className="text-rose-500">*</span>
                    </label>
                    <select
                      data-testid="select-payment-bank-name"
                      value={formData.paymentAccount.bankName}
                      onChange={(e) => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, bankName: e.target.value } }))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800 cursor-pointer"
                    >
                      <option value="">-- เลือกธนาคาร --</option>
                      {BANK_OPTIONS.map((bank) => (
                        <option key={bank} value={bank}>{bank}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">เลขที่บัญชีธนาคาร <span className="text-rose-500">*</span> </label>
                    <input
                      type="text"
                      data-testid="input-payment-account-number"
                      disabled={!formData.paymentAccount.bankName}
                      value={formData.paymentAccount.accountNumber}
                      onChange={(e) => setFormData(prev => ({ ...prev, paymentAccount: { ...prev.paymentAccount, accountNumber: formatBankAccount(e.target.value) } }))}
                      placeholder={formData.paymentAccount.bankName ? "XXX-X-XXXXX-X" : "กรุณาเลือกธนาคารก่อน"}
                      className={`w-full px-3.5 py-2 text-xs border rounded-xl outline-none font-bold transition-all ${formData.paymentAccount.bankName
                        ? 'bg-white border-slate-200 focus:border-blue-500 text-slate-800'
                        : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-75'
                        }`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ชื่อบัญชีธนาคาร <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    data-testid="input-payment-account-name"
                    value={formData.paymentAccount.bankAccountName || formData.paymentAccount.accountName || ''}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      paymentAccount: {
                        ...prev.paymentAccount,
                        accountName: e.target.value,
                        bankAccountName: e.target.value
                      }
                    }))}
                    placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"
                    className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800"
                  />
                </div>
              </div>

              {/* Sub-section 2: PromptPay Details */}
              <div className="bg-white p-4 rounded-xl border border-indigo-200/90 shadow-2xs space-y-3.5">
                <div className="flex items-center gap-2 pb-2 border-b border-indigo-100">
                  <div className="w-5 h-5 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-[11px]">
                    2
                  </div>
                  <h5 className="text-xs font-black text-indigo-950">ข้อมูลบัญชีพร้อมเพย์</h5>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      เลขพร้อมเพย์ (เบอร์ / บัตรปชช.)
                    </label>
                    <input
                      type="text"
                      value={formData.paymentAccount.promptPayId}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '');
                        const formatted = raw.length > 10 ? formatIdCard(e.target.value) : formatPhone(e.target.value);
                        setFormData({ ...formData, paymentAccount: { ...formData.paymentAccount, promptPayId: formatted } });
                      }}
                      placeholder="เช่น 081-999-8888"
                      className="w-full px-3.5 py-2 text-xs bg-white border border-indigo-200 rounded-xl focus:border-indigo-500 outline-none font-bold text-indigo-600"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">
                        ชื่อบัญชีพร้อมเพย์
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            paymentAccount: {
                              ...prev.paymentAccount,
                              promptPayName: prev.paymentAccount.bankAccountName || ''
                            }
                          }))}
                          className="text-[10px] font-extrabold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2 py-0.5 rounded-lg transition-all cursor-pointer"
                        >
                          ดึงชื่อเจ้าของ
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={formData.paymentAccount.promptPayName || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        paymentAccount: { ...formData.paymentAccount, promptPayName: e.target.value }
                      })}
                      placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีพร้อมเพย์)"
                      className="w-full px-3.5 py-2 text-xs bg-white border border-indigo-200 rounded-xl focus:border-indigo-500 outline-none font-bold text-slate-800"
                    />
                  </div>
                </div>
              </div>

              <div className="p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl flex items-start gap-1.5 text-[11px] text-blue-800 font-medium leading-relaxed">
                <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong>ข้อสำคัญ:</strong> ชื่อบัญชีธนาคารและชื่อบัญชีพร้อมเพย์ ต้องระบุให้ตรงกับข้อมูลจริง เพื่อให้ระบบตรวจสลิปทำงานได้แม่นยำ (เช่น น.ส. หอพลัส จำกัด)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5: Pet Policy (Pet fee fields removed) & Contract Signature */}
      {currentStep === 5 && (
        <div className="bg-white p-5 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <FileText className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-black text-slate-800">ขั้นตอนที่ 5: กฎระเบียบ & สัญญา</h3>
              <p className="text-xs text-slate-400 font-medium">กำหนดนโยบายการเลี้ยงสัตว์ ข้อตกลงโครงการ และเซ็นลายเซ็นอิเล็กทรอนิกส์</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Left Column: Pet Policy & Owner Signature */}
            <div className="space-y-4 flex flex-col justify-between">
              {/* Pet Policy */}
              <div className="bg-slate-50/60 p-4 sm:p-5 rounded-2xl border border-slate-100 space-y-4">
                <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                  <Dog className="w-4 h-4 text-emerald-600" /> กฎการเลี้ยงสัตว์
                </h4>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">เงื่อนไขการเลี้ยงสัตว์ในหอพัก</label>
                  <select
                    value={formData.petPolicy.allowed}
                    onChange={(e) => setFormData({ ...formData, petPolicy: { ...formData.petPolicy, allowed: e.target.value } })}
                    className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-extrabold"
                  >
                    <option value="none">ไม่อนุญาตให้เลี้ยงสัตว์ทุกชนิด</option>
                    <option value="conditional">อนุญาตให้เลี้ยงสัตว์ได้</option>
                  </select>
                </div>

                {formData.petPolicy.allowed !== 'none' && (
                  <div className="space-y-3 pt-2 border-t border-slate-200/60">
                    <span className="text-xs font-bold text-slate-700 block">เลือกประเภทสัตว์ที่อนุญาต:</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'dog', label: 'สุนัข' },
                        { id: 'cat', label: 'แมว' },
                        { id: 'small_pet', label: 'สัตว์เลี้ยงขนาดเล็ก / นก' },
                        { id: 'other', label: 'อื่นๆ' }
                      ].map(pet => (
                        <label key={pet.id} className="flex items-center gap-2 p-2 bg-white rounded-xl border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={formData.petPolicy.allowedTypes.includes(pet.id)}
                            onChange={(e) => {
                              const exists = formData.petPolicy.allowedTypes.includes(pet.id);
                              const updated = exists
                                ? formData.petPolicy.allowedTypes.filter(t => t !== pet.id)
                                : [...formData.petPolicy.allowedTypes, pet.id];
                              setFormData({ ...formData, petPolicy: { ...formData.petPolicy, allowedTypes: updated } });
                            }}
                            className="rounded text-blue-600 focus:ring-blue-500"
                          />
                          <span>{pet.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Owner Electronic Signature */}
              <div className="bg-slate-50/60 p-4 sm:p-5 rounded-2xl border border-slate-100 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                    <PenTool className="w-4 h-4 text-blue-600" /> ลายเซ็นเจ้าของหอพักสำหรับเอกสารสัญญาเช่า
                  </h4>
                  <button
                    type="button"
                    onClick={clearCanvas}
                    className="text-[11px] font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-rose-100 px-2.5 py-1 rounded-xl transition-all cursor-pointer"
                  >
                    ล้างลายเซ็น
                  </button>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-2.5 space-y-2 relative overflow-hidden shadow-3xs">
                  <canvas
                    ref={canvasRef}
                    width={320}
                    height={110}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full h-28 touch-none bg-slate-50/50 rounded-xl border border-dashed border-slate-200 cursor-crosshair"
                  />

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 flex-wrap">
                    <p className="text-[10px] text-slate-400 font-medium">ใช้นิ้วหรือเมาส์วาดลายเซ็นในกรอบด้านบน</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Full-Height Contract Rules Form */}
            <div className="bg-slate-50/60 p-4 sm:p-5 rounded-2xl border border-slate-100 flex flex-col space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-xs font-black text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
                  <FileText className="w-4 h-4 text-blue-600" /> แบบฟอร์มข้อตกลงสัญญา & ระเบียบโครงการ
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const allRules = PRESET_DORM_RULES.map(r => r.text).join('\n');
                      setFormData({ ...formData, rulesTemplate: allRules });
                    }}
                    className="text-[11px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 px-2.5 py-1 rounded-xl transition-all cursor-pointer"
                  >
                    + เลือกทั้งหมด 10 ข้อ
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, rulesTemplate: '' })}
                    className="text-[11px] font-extrabold text-rose-500 hover:text-rose-700 hover:underline px-1.5 py-1 transition-all cursor-pointer"
                  >
                    ล้างข้อความ
                  </button>
                </div>
              </div>

              {/* 10 Preset Rule Option Chips - Responsive for mobile, tablet, desktop */}
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold text-slate-600">
                  คลิกปุ่มเพื่อเพิ่ม/ยกเลิก ข้อตกลงสำเร็จรูป:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-5 gap-2">
                  {PRESET_DORM_RULES.map((rule) => {
                    const isSelected = (formData.rulesTemplate || '').includes(rule.text);

                    const toggleRule = () => {
                      const current = formData.rulesTemplate || '';
                      if (isSelected) {
                        const updated = current
                          .split('\n')
                          .filter(line => line.trim() !== rule.text.trim())
                          .join('\n')
                          .trim();
                        setFormData({ ...formData, rulesTemplate: updated });
                      } else {
                        const newText = current.trim() ? `${current.trim()}\n${rule.text}` : rule.text;
                        setFormData({ ...formData, rulesTemplate: newText });
                      }
                    };

                    return (
                      <button
                        key={rule.id}
                        type="button"
                        onClick={toggleRule}
                        className={`text-left p-2 rounded-xl border text-[11px] font-bold transition-all flex items-center justify-between gap-1.5 cursor-pointer ${isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-3xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                          }`}
                      >
                        <span className="truncate">{rule.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-black shrink-0 ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                          }`}>
                          {isSelected ? '✓' : '+ เพิ่ม'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 flex flex-col space-y-1.5 pt-2 border-t border-slate-200/60">
                <label className="block text-xs font-bold text-slate-700">ข้อความระเบียบทั้งหมดที่แสดงในสัญญา:</label>
                <textarea
                  value={formData.rulesTemplate}
                  onChange={(e) => setFormData({ ...formData, rulesTemplate: e.target.value })}
                  placeholder="ระบุข้อตกลงและระเบียบเพิ่มเติม หรือเลือกจากตัวเลือกด้านบน..."
                  className="w-full flex-1 min-h-[220px] p-3.5 text-xs bg-white border border-slate-200 rounded-2xl focus:border-blue-500 outline-none font-medium leading-relaxed resize-none shadow-2xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 6: LINE OA Integration */}
      {currentStep === 6 && (
        <div className="bg-white p-4 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 flex-wrap">
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <h3 className="text-sm sm:text-base font-black text-slate-800">ขั้นตอนที่ 6: เชื่อมต่อ LINE OA</h3>
                <p className="text-[11px] sm:text-xs text-slate-400 font-medium">ตั้งค่าระบบแจ้งเตือนบิล ค่าน้ำไฟ และรับชำระผ่าน LINE Official Account</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setValidationError(null);
                setCurrentStep(7);
              }}
              className="text-xs font-black text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3.5 py-1.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <span>ตั้งค่าภายหลัง</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="bg-emerald-50/60 p-4 sm:p-5 rounded-3xl border border-emerald-100 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-xs overflow-hidden">
                  {formData.lineOA.isConnected && formData.lineOA.botPictureUrl ? (
                    <img
                      src={formData.lineOA.botPictureUrl}
                      alt={formData.lineOA.botDisplayName || 'LINE OA'}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : formData.lineOA.isConnected ? (
                    <div className="w-full h-full bg-emerald-600 text-white flex items-center justify-center font-black text-xs">
                      OA
                    </div>
                  ) : (
                    <Bot className="w-6 h-6 text-slate-400" />
                  )}
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-slate-800">
                    {formData.lineOA.isConnected
                      ? (formData.lineOA.botDisplayName || 'LINE Official Account')
                      : 'ยังไม่ได้เชื่อมต่อ LINE OA'}
                  </h4>
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span className="text-[11px] sm:text-xs text-slate-500 font-bold">LINE ID:</span>
                    <span className={`text-[11px] sm:text-xs font-black px-2 py-0.5 rounded-md ${formData.lineOA.isConnected
                        ? 'text-emerald-800 bg-emerald-100/90'
                        : 'text-slate-500 bg-slate-100'
                      }`}>
                      {formData.lineOA.isConnected
                        ? (formData.lineOA.lineOaId || formData.lineOA.oaName || 'เชื่อมต่อแล้ว')
                        : 'ยังไม่ได้ตรวจสอบ'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <span className={`px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 ${formData.lineOA.isConnected
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${formData.lineOA.isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                    }`} />
                  {formData.lineOA.isConnected ? 'เชื่อมต่อสำเร็จ' : 'ยังไม่ได้ตรวจสอบ'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  LINE Channel ID <span className="text-[11px] font-normal text-slate-400">(ไม่บังคับ - สามารถตั้งค่าภายหลังได้)</span>
                </label>
                <input
                  type="text"
                  value={formData.lineOA.channelId}
                  onChange={(e) => {
                    setFormData(prev => ({
                      ...prev,
                      lineOA: {
                        ...prev.lineOA,
                        channelId: e.target.value,
                        isConnected: false,
                        botDisplayName: '',
                        botPictureUrl: '',
                        lineOaId: '',
                        oaName: ''
                      }
                    }));
                    setLineStatusMsg(null);
                  }}
                  placeholder="เช่น 1657889900"
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  LINE Channel Secret <span className="text-[11px] font-normal text-slate-400">(ไม่บังคับ - สามารถตั้งค่าภายหลังได้)</span>
                </label>
                <input
                  type="password"
                  value={formData.lineOA.channelSecret}
                  onChange={(e) => {
                    setFormData(prev => ({
                      ...prev,
                      lineOA: {
                        ...prev.lineOA,
                        channelSecret: e.target.value,
                        isConnected: false,
                        botDisplayName: '',
                        botPictureUrl: '',
                        lineOaId: '',
                        oaName: ''
                      }
                    }));
                    setLineStatusMsg(null);
                  }}
                  placeholder="e4d8f9c2a1b3c4d5e6f7..."
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-emerald-500 outline-none font-mono text-xs"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestLineConnection}
                disabled={testingLine}
                className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${testingLine ? 'animate-spin' : ''}`} />
                <span>{testingLine ? 'กำลังทดสอบสัญญาณ...' : 'ทดสอบตรวจสถานะ LINE OA'}</span>
              </button>

              {lineStatusMsg && (
                <span className={`text-xs font-bold ${lineStatusMsg.type === 'success' ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {lineStatusMsg.msg}
                </span>
              )}
            </div>
          </div>

          {/* Registration Summary Card */}
          <div className="bg-slate-50 p-4 sm:p-5 rounded-3xl border border-slate-200 space-y-3">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-blue-600" /> สรุปข้อมูลหอพักพร้อมเปิดใช้งาน
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-white p-3 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-400 font-bold block">ชื่อหอพัก</span>
                <span className="font-extrabold text-slate-800 truncate block">{formData.dormName}</span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-400 font-bold block">จำนวนอาคาร</span>
                <span className="font-extrabold text-blue-600 block">{formData.buildings.length} อาคาร</span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-400 font-bold block">รวมจำนวนห้องพัก</span>
                <span className="font-extrabold text-slate-800 block">
                  {formData.buildings.reduce((sum, b) => sum + getGeneratedRooms(b).length, 0)} ห้อง
                </span>
              </div>
              <div className="bg-white p-3 rounded-2xl border border-slate-100">
                <span className="text-[10px] text-slate-400 font-bold block">สถานะ LINE OA</span>
                <span className="font-extrabold text-emerald-600 block">{formData.lineOA.isConnected ? 'พร้อมใช้งาน' : 'รอยืนยัน'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 7: Package Selection & Confirmation */}
      {currentStep === 7 && (
        <div className="bg-white p-4 sm:p-8 rounded-3xl border border-slate-100 shadow-xs space-y-6 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Sparkles className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-800">ขั้นตอนที่ 7: เลือกแพ็กเกจและยืนยันการเปิดใช้งาน</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 font-medium">เลือกแพ็กเกจที่เหมาะสมสำหรับหอพักของคุณ (เริ่มต้นใช้งานฟรีถาวร หรือทดลองใช้ PRO)</p>
            </div>
          </div>

          {/* Quote Error / Retry Banner */}
          {quoteError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between gap-3 text-rose-800 animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="text-xs font-bold">{quoteError}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setQuoteError(null);
                  setTrialState('unknown');
                  setSelectedPlan(prev => prev);
                }}
                className="px-3 py-1 bg-rose-600 text-white rounded-lg text-xs font-black hover:bg-rose-700 transition"
              >
                ลองใหม่อีกครั้ง
              </button>
            </div>
          )}

          {/* 2 Main Plan Cards (FREE vs PRO) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* FREE Plan Card */}
            <div
              onClick={() => {
                setSelectedPlan('free');
                setSelectedPackageId(null);
              }}
              className={`p-4 sm:p-5 rounded-2xl border-2 transition-all cursor-pointer relative bg-white ${selectedPlan === 'free'
                ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-xs'
                : 'border-slate-200 hover:border-slate-300'
                }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800">
                  แพ็กเกจฟรีถาวร
                </span>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${selectedPlan === 'free'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'border-2 border-slate-300'
                    }`}
                >
                  {selectedPlan === 'free' && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
              </div>

              <div className="mt-3">
                <h4 className="text-sm sm:text-base font-black text-slate-900">HorPlus FREE</h4>
                <div className="mt-0.5 flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-xl sm:text-2xl font-black text-indigo-600">฿0</span>
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-500">
                    / เดือน
                  </span>
                </div>
              </div>

              <ul className="mt-3.5 space-y-2 text-[11px] sm:text-xs font-bold text-slate-700">
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>เปิดใช้งานได้พร้อมกัน 10 ห้องพักแรก</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>สร้างตึกและห้องพักได้ไม่จำกัดเพื่อวางผัง</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>ระบบบันทึกบัญชี ออกบิล และใบเสร็จรับเงินอัตโนมัติ</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>โควตา LINE แจ้งเตือน 30 ข้อความ/เดือน</span>
                </li>
              </ul>
            </div>

            {/* PRO Plan Card */}
            <div
              onClick={() => {
                setSelectedPlan('pro');
                if (!selectedPackageId && packages.length > 0) {
                  setSelectedPackageId(packages[0].id);
                }
              }}
              className={`p-4 sm:p-5 rounded-2xl border-2 transition-all cursor-pointer relative bg-white ${selectedPlan === 'pro'
                ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-xs'
                : 'border-slate-200 hover:border-slate-300'
                }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-800">
                  {accountTrialAvailable === true ? 'สิทธิ์ทดลองใช้ PRO ฟรี 1 เดือน' : 'HorPlus PRO'}
                </span>
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${selectedPlan === 'pro'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'border-2 border-slate-300'
                    }`}
                >
                  {selectedPlan === 'pro' && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
              </div>

              <div className="mt-3">
                <h4 className="text-sm sm:text-base font-black text-slate-900">HorPlus PRO</h4>
                <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
                  {accountTrialAvailable === true && selectedDurationMonths === 1 ? (
                    <>
                      <span className="text-xl sm:text-2xl font-black text-emerald-600">฿0</span>
                      <span className="text-xs line-through text-slate-400 font-bold">฿189</span>
                      <span className="text-xs line-through text-slate-300 font-medium">฿990</span>
                      <span className="text-[11px] sm:text-xs font-semibold text-slate-500">/ เดือนแรก (ทดลองใช้ฟรี)</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xl sm:text-2xl font-black text-indigo-600">
                        ฿{formatPrice(packages.find(p => p.id === selectedPackageId)?.price || 189)}
                      </span>
                      {packages.find(p => p.id === selectedPackageId)?.referencePrice && (
                        <span className="text-xs line-through text-slate-400 font-bold">
                          ฿{formatPrice(packages.find(p => p.id === selectedPackageId)?.referencePrice)}
                        </span>
                      )}
                      <span className="text-[11px] sm:text-xs font-semibold text-slate-500">
                        / {selectedDurationMonths} เดือน
                      </span>
                    </>
                  )}
                </div>
              </div>

              <ul className="mt-3.5 space-y-2 text-[11px] sm:text-xs font-bold text-slate-700">
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>รองรับสูงสุด 150 ห้องพัก</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>โควตา LINE แจ้งเตือน 300 ข้อความ/เดือน</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>ฟังก์ชันระบบบริหารจัดการหอพักเต็มรูปแบบ</span>
                </li>
              </ul>
            </div>
          </div>

          {/* 5 PRO Packages Duration Selector (When PRO is selected) */}
          {selectedPlan === 'pro' && packages.length > 0 && (
            <div className="bg-slate-50 p-4 sm:p-5 rounded-3xl border border-slate-200 space-y-3">
              <label className="block text-xs font-black text-slate-800">
                เลือกระยะเวลาแพ็กเกจ HorPlus PRO:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {packages.map((pkg) => {
                  const isSelected = selectedPackageId === pkg.id;
                  const is1moTrial = pkg.durationMonths === 1 && accountTrialAvailable === true;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => {
                        setSelectedPackageId(pkg.id);
                        setSelectedDurationMonths(pkg.durationMonths);
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer relative flex flex-col justify-between ${isSelected
                        ? 'bg-white border-indigo-600 ring-2 ring-indigo-100 shadow-xs'
                        : 'bg-white/80 border-slate-200 hover:border-indigo-300'
                        }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-black text-slate-800">{pkg.durationMonths} เดือน</span>
                          {is1moTrial && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                              ทดลองใช้ฟรี
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
                          {is1moTrial ? (
                            <>
                              <span className="text-sm font-black text-emerald-600">฿0</span>
                              <span className="text-[10px] line-through text-slate-400 font-bold">฿{formatPrice(pkg.price || 189)}</span>
                              {pkg.referencePrice && (
                                <span className="text-[10px] line-through text-slate-300 font-medium">฿{formatPrice(pkg.referencePrice)}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="text-sm font-black text-indigo-600">฿{formatPrice(pkg.price)}</span>
                              {pkg.referencePrice && (
                                <span className="text-[10px] line-through text-slate-400">฿{formatPrice(pkg.referencePrice)}</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 mt-2">
                        เฉลี่ย ~฿{formatPrice(Math.round(Number(pkg.price) / pkg.durationMonths))}/เดือน
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Step 7 Optional Benefits: Referral Code (Left) & Promo Code (Right) in 2-Column Grid on Desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Referral Code (Optional) */}
            <div className="bg-indigo-50/50 p-4 sm:p-5 rounded-3xl border border-indigo-100 space-y-2.5 flex flex-col justify-between" data-testid="card-referral-code">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-indigo-600" /> รหัสคำเชิญที่ใช้สมัคร (ไม่บังคับ)
                  </label>
                  {isReferralBound && (
                    <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Lock className="w-3 h-3" /> ผูกสิทธิ์แล้ว
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-1">
                  กรอกรหัสแนะนำ 6 หลักของเพื่อน เพื่อรับ 10 HorPlus Coins (฿10) ทันที (เว้นว่างได้)
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    disabled={isReferralBound}
                    value={referralCodeInput}
                    onChange={(e) => {
                      setReferralCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setReferralInlineError(null);
                    }}
                    placeholder="เช่น 123456"
                    className="flex-1 px-3.5 py-2 text-xs font-black tracking-widest bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500 font-mono"
                    data-testid="input-referral-code"
                  />
                  {!isReferralBound && (
                    <button
                      type="button"
                      disabled={isCheckingReferral || referralCodeInput.length !== 6}
                      onClick={handleCheckReferral}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs shrink-0 flex items-center gap-1.5"
                      data-testid="button-check-referral"
                    >
                      {isCheckingReferral && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>ตรวจสอบ</span>
                    </button>
                  )}
                </div>

                {referralInlineError && (
                  <p className="text-xs font-bold text-rose-600 mt-2 flex items-center gap-1" data-testid="referral-inline-error">
                    <span>✕</span> {referralInlineError}
                  </p>
                )}
                {referralInlineSuccess && (
                  <p className="text-xs font-bold text-emerald-700 mt-2 flex items-center gap-1" data-testid="referral-inline-success">
                    <span>✓</span> {referralInlineSuccess}
                  </p>
                )}
              </div>
            </div>

            {/* Promo Code Box (Optional) */}
            <div className="p-4 sm:p-5 bg-indigo-50/50 border border-indigo-100 rounded-3xl space-y-2.5 flex flex-col justify-between" data-testid="card-promo-code">
              <div>
                <p className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-indigo-600" /> กรอกรหัสโปรโมชั่น (ไม่บังคับ)
                </p>
                <p className="text-[11px] text-slate-500 font-medium mt-1">
                  กรอก "HORPLUS" เพื่อรับสิทธิ์ทดลองใช้งานฟรีเพิ่ม 2 เดือน (จำกัด 100 สิทธิ์แรก, เว้นว่างได้)
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={promoCodeInput}
                    onChange={(e) => {
                      setPromoCodeInput(e.target.value);
                      if (appliedPromo) {
                        setValidatedPromoCode(undefined);
                        setPromoBenefitUnit(null);
                        setPromoBenefitValue(null);
                        setPromoBenefitLabel(null);
                        setAppliedPromo(false);
                        setPromoMessage(null);
                      }
                    }}
                    placeholder="HORPLUS"
                    className="flex-1 px-4 py-2 text-xs font-black uppercase tracking-wider bg-white border border-slate-200 rounded-xl outline-none focus:border-indigo-600"
                    data-testid="input-promo-code"
                  />
                  <button
                    type="button"
                    disabled={isCheckingPromo || !promoCodeInput.trim()}
                    onClick={handleApplyPromo}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs shrink-0 flex items-center gap-1.5"
                    data-testid="button-apply-promo"
                  >
                    {isCheckingPromo && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>ใช้รหัส</span>
                  </button>
                </div>

                {promoMessage && (
                  <p className={`text-xs font-bold mt-2 ${appliedPromo ? 'text-emerald-700' : 'text-rose-600'}`} data-testid="promo-inline-message">
                    {promoMessage}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Coins Wallet Discount & Quote Summary */}
          {selectedPlan === 'pro' && (
            <div className="bg-slate-50 p-4 sm:p-5 rounded-3xl border border-slate-200 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-500" />
                  <div>
                    <h4 className="text-xs font-black text-slate-800">HorPlus Coin Wallet</h4>
                    <p className="text-[11px] text-slate-500 font-medium">1 Coin = ส่วนลด ฿1 บาท</p>
                  </div>
                </div>
                <span className="text-xs font-black text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
                  คงเหลือ: {formatPrice(coinWalletBalance)} Coins
                </span>
              </div>

              {coinWalletBalance > 0 && (
                <div className="flex items-center gap-3 pt-1">
                  <label className="text-xs font-bold text-slate-700">ใช้ Coins เป็นส่วนลด:</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={coinToApply}
                    onChange={(e) => {
                      const norm = normalizeNumericInput(e.target.value, false);
                      const parsed = norm === '' ? 0 : (parseInt(norm, 10) || 0);
                      setCoinToApply(Math.min(coinWalletBalance, Math.max(0, parsed)));
                    }}
                    className="w-24 px-3 py-1.5 text-xs font-black bg-white border border-slate-200 rounded-xl outline-none focus:border-amber-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setCoinToApply(coinWalletBalance)}
                    className="text-[11px] font-black text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-xl cursor-pointer"
                  >
                    ใช้ทั้งหมด
                  </button>
                </div>
              )}

              {/* Price Calculation Breakdown */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-600 font-bold">
                  <span>ราคาแพ็กเกจ HorPlus PRO ({selectedDurationMonths} เดือน):</span>
                  <span>฿{formatPrice(quoteSummary?.priceSnapshot || packages.find(p => p.id === selectedPackageId)?.price || 189)}</span>
                </div>

                {isFirstTrialEligible && selectedDurationMonths === 1 && (
                  <div className="flex items-center justify-between text-emerald-600 font-black">
                    <span>ส่วนลดสิทธิ์ทดลองใช้ฟรี 1 เดือนแรก:</span>
                    <span>- ฿{formatPrice(packages.find(p => p.id === selectedPackageId)?.price || 189)}</span>
                  </div>
                )}

                {appliedPromo && (
                  <div className="flex items-center justify-between text-indigo-600 font-black">
                    <span>สิทธิ์โปรโมชัน {validatedPromoCode || 'HORPLUS'}:</span>
                    <span>+{promoBenefitLabel || (promoBenefitUnit === 'DAY' ? `${promoBenefitValue} วัน` : `${promoBenefitValue || 2} เดือน`)} HorPlus PRO</span>
                  </div>
                )}

                {coinToApply > 0 && (
                  <div className="flex items-center justify-between text-amber-600 font-black">
                    <span>ส่วนลด HorPlus Coins ({formatPrice(coinToApply)} Coins):</span>
                    <span>- ฿{formatPrice(coinToApply)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-sm font-black text-slate-900 pt-2 border-t border-slate-100">
                  <span>ยอดชำระสุทธิ:</span>
                  <span className="text-base text-indigo-600 font-black">
                    ฿{formatPrice(quoteSummary?.finalPayableAmount !== undefined
                      ? quoteSummary.finalPayableAmount
                      : (isFirstTrialEligible && selectedDurationMonths === 1 ? 0 : Math.max(0, (packages.find(p => p.id === selectedPackageId)?.price || 189) - coinToApply)))}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Step Control Actions */}
      <div className="space-y-3">
        {/* Validation Warning Alert (Placed near Next button) */}
        {validationError && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl shadow-md flex items-center justify-between gap-3 text-rose-800 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2.5 text-xs font-black">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{validationError}</span>
            </div>
            <button
              onClick={() => setValidationError(null)}
              className="text-rose-500 hover:text-rose-700 p-1 rounded-lg hover:bg-rose-100 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between bg-white p-4 rounded-3xl border border-slate-100 shadow-md">
          <button
            onClick={() => setCurrentStep(prev => Math.max(prev - 1, 1))}
            disabled={currentStep === 1}
            className={`px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${currentStep === 1 ? 'opacity-30 cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
          >
            <ArrowLeft className="w-4 h-4" />
            ย้อนกลับ
          </button>

          <div className="flex items-center gap-2">

            {currentStep < 7 ? (
              <button
                onClick={handleNextStep}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black transition-all flex items-center gap-2 shadow-md cursor-pointer"
              >
                ถัดไป
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSaveRegistration}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black transition-all flex items-center gap-2 shadow-lg cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>ยืนยันสร้างหอพัก</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Terms & Conditions / Referral Survey Modal */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100 p-5 sm:p-6 space-y-5 animate-in zoom-in-95 duration-200">

            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-800 leading-tight">
                    เงื่อนไข & ช่องทางที่รู้จัก
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    โปรดยืนยันข้อตกลงการใช้บริการระบบบริหารจัดการหอพัก HorPlus
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Survey Question: How did you know HorPlus (Placed on Top) */}
            <div className="space-y-2.5 pb-2 border-b border-slate-100">
              <label className="block text-xs font-black text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-500" />
                คุณรู้จัก HorPlus มาจากช่องทางไหน? <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {REFERRAL_OPTIONS.map((opt) => {
                  const isSelected = referralSource === opt.id;
                  const IconComp = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setReferralSource(opt.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer text-xs font-bold flex items-center gap-2 ${isSelected
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-100/80'
                        }`}
                    >
                      <IconComp className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-blue-600'}`} />
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {referralSource === 'other' && (
                <input
                  type="text"
                  value={referralOtherText}
                  onChange={(e) => setReferralOtherText(e.target.value)}
                  placeholder="ระบุช่องทางอื่นๆ ที่รู้จัก HorPlus..."
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-bold text-slate-800 mt-2"
                />
              )}
            </div>

            {/* Terms & Regulations Scroll Box (Placed below survey) */}
            <div className="space-y-2">
              <label className="block text-xs font-black text-slate-700 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-600" />
                ข้อบังคับและกฎหมายการใช้งานระบบ HorPlus
              </label>
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-[11px] text-slate-600 space-y-2.5 max-h-36 overflow-y-auto leading-relaxed font-medium">
                <p className="font-bold text-slate-800">1. การคุ้มครองข้อมูลส่วนบุคคล (PDPA):</p>
                <p className="text-slate-600">
                  ผู้ใช้งานยินยอมให้ระบบ HorPlus จัดเก็บ ประมวลผล และบริหารจัดการข้อมูลผู้เช่า สัญญาเช่า ค่าน้ำไฟ และเอกสารที่เกี่ยวข้อง เพื่อวัตถุประสงค์ในการให้บริการระบบหอพักอย่างปลอดภัย
                </p>
                <p className="font-bold text-slate-800">2. ข้อบังคับทางกฎหมายและสัญญาเช่า:</p>
                <p className="text-slate-600">
                  ผู้ให้เช่าต้องตรวจสอบความถูกต้องของสัญญาเช่า ใบแจ้งหนี้ และข้อกำหนดอัตราค่าบริการค่าน้ำ-ค่าไฟให้สอดคล้องกับประกาศ สคบ. และกฎหมายที่เกี่ยวข้อง
                </p>
                <p className="font-bold text-slate-800">3. ความปลอดภัยและสิทธิ์ใช้งาน:</p>
                <p className="text-slate-600">
                  ผู้ใช้งานต้องเก็บรักษารหัสผ่านและสิทธิ์ผู้จัดการระบบเป็นความลับ ระบบ HorPlus จะไม่รับผิดชอบต่อความเสียหายจากการเผยแพร่ข้อมูลรับชำระโดยไม่ได้รับอนุญาต
                </p>
              </div>
            </div>

            {/* Checkbox Agreement */}
            <label className="flex items-start gap-2.5 p-3 bg-blue-50/60 border border-blue-200/70 rounded-2xl cursor-pointer hover:bg-blue-50 transition-all">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-blue-600 rounded cursor-pointer accent-blue-600 shrink-0"
              />
              <span className="text-xs font-bold text-slate-800 leading-snug">
                ข้าพเจ้าได้อ่าน เข้าใจ และยินยอมปฏิบัติตามเงื่อนไข ข้อบังคับทางกฎหมาย และนโยบายการใช้งานระบบ HorPlus ทุกประการ <span className="text-rose-500">*</span>
              </span>
            </label>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmTermsAndComplete}
                disabled={!agreedTerms || !referralSource || (referralSource === 'other' && !referralOtherText.trim())}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black transition-all shadow-md cursor-pointer flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                ยอมรับเงื่อนไข
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
